import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { type Combination, combinations } from './combinations.ts';
import { collectCoverage } from './coverage.ts';
import { type Client, connect, type DatabaseVersions, type Directus } from './directus.ts';
import { activateLicense, publicUrl, readLicenseKey } from './license.ts';
import { versionsOf as postgresVersionsOf } from './postgres.ts';
import { seed } from './seed.ts';
import { directusWithSpatialite, versionsOf as sqliteVersionsOf } from './sqlite.ts';

// Where Directus loads the extension from, and where Node writes the coverage of the Directus processes.
const extensionInContainer = '/directus/extensions/directus-extension-geospatial';
const coverageInContainer = '/tmp/v8-coverage';

const extension = new URL('../packages/extension/', import.meta.url);

const newSecret = () => randomBytes(32).toString('hex');

const seconds = (since: number) => ((performance.now() - since) / 1000).toFixed(1);

const log = (text: string) => process.stdout.write(`${text}\n`);

interface Started {
	combination: Combination;
	directus: Directus;
	// The folder where Node writes the coverage of this Directus.
	recorded: string;
	stop: () => Promise<void>;
}

// What differs between the databases of the combinations.
interface Backend {
	// Directus, before it starts, and what it needs to reach its database.
	directus: GenericContainer;
	environment: Record<string, string>;
	versions: (directus: StartedTestContainer) => Promise<DatabaseVersions>;
	// Applies the key of the tests, which only goes to the PostGIS database, under the project the key is bound to. Any
	// other database would be another project, and another activation of the key (D-043, D-044).
	activate?: (admin: Client, key: string) => Promise<void>;
	stop: () => Promise<void>;
}

const withPostgis = async (directus: string, image: string): Promise<Backend> => {
	const network = await new Network().start();

	const database = await new PostgreSqlContainer(image)
		.withNetwork(network)
		.withNetworkAliases('database')
		.withDatabase('directus')
		.withUsername('directus')
		.withPassword(newSecret())
		.start();

	return {
		directus: new GenericContainer(directus).withNetwork(network),
		environment: {
			DB_CLIENT: 'pg',
			DB_HOST: 'database',
			DB_PORT: '5432',
			DB_DATABASE: database.getDatabase(),
			DB_USER: database.getUsername(),
			DB_PASSWORD: database.getPassword(),
		},
		versions: () => postgresVersionsOf(database),
		activate: (admin, key) => activateLicense(admin, database, key),
		stop: async () => {
			await database.stop();
			await network.stop();
		},
	};
};

// SQLite has no container of its own: Directus opens the file its image points DB_FILENAME to.
const withSqlite = async (combination: Combination): Promise<Backend> => {
	const builtAt = performance.now();
	const directus = await directusWithSpatialite(combinations[combination].directus);

	log(`${combination}: built the image of Directus with SpatiaLite in ${seconds(builtAt)} s`);

	return { directus, environment: {}, versions: sqliteVersionsOf, stop: () => Promise.resolve() };
};

// Starts the database and the Directus of one combination, with the built extension, and builds the schema, the roles
// and the data.
const start = async (combination: Combination, licenseKey: string | undefined): Promise<Started> => {
	const images = combinations[combination];

	const backend =
		images.database.client === 'postgres'
			? await withPostgis(images.directus.image, images.database.image)
			: await withSqlite(combination);

	// The container user of Directus writes the coverage here, so the folder is open to any user.
	const recorded = await mkdtemp(join(tmpdir(), 'geospatial-coverage-'));
	await chmod(recorded, 0o777);

	const adminToken = newSecret();
	const startedAt = performance.now();

	const directus = await backend.directus
		.withEnvironment({
			...backend.environment,
			SECRET: newSecret(),
			ADMIN_EMAIL: 'admin@example.com',
			ADMIN_PASSWORD: newSecret(),
			ADMIN_TOKEN: adminToken,
			// Directus 12 binds the license key to it (D-044). The suite reaches Directus by the mapped port instead.
			PUBLIC_URL: publicUrl,
			// Directus exits if the extension fails to load, instead of answering 404 on its routes.
			EXTENSIONS_MUST_LOAD: 'true',
			// Directus 12 sends the telemetry anyway, because both the Core tier and the license require it (V-116).
			TELEMETRY: 'false',
			// Node writes the coverage of each process when it exits, and pm2 waits this long before killing Directus.
			NODE_V8_COVERAGE: coverageInContainer,
			PM2_KILL_TIMEOUT: '30000',
		})
		// A copy of the built package, as an installation has it. The coverage comes back through a mount.
		.withCopyFilesToContainer([
			{ source: fileURLToPath(new URL('package.json', extension)), target: `${extensionInContainer}/package.json` },
		])
		.withCopyDirectoriesToContainer([
			{ source: fileURLToPath(new URL('dist', extension)), target: `${extensionInContainer}/dist` },
		])
		.withBindMounts([{ source: recorded, target: coverageInContainer, mode: 'rw' }])
		.withExposedPorts(8055)
		// /server/health refuses a request without a session from Directus 12 on (V-110).
		.withWaitStrategy(Wait.forHttp('/server/ping', 8055))
		.withStartupTimeout(180_000)
		.start();

	log(`${combination}: Directus started in ${seconds(startedAt)} s`);

	const url = `http://${directus.getHost()}:${String(directus.getMappedPort(8055))}`;
	const admin = connect(url, adminToken);

	// Directus 12 starts on the Core tier, which refuses permissions with rules of their own, and the key of the Open
	// Innovation Grant lifts that (V-114, D-043). Directus 11 has no license key.
	const tiered = Number(images.directus.version.split('.')[0]) >= 12;
	const { activate } = backend;

	if (tiered && licenseKey !== undefined && activate !== undefined) {
		const activatingAt = performance.now();

		await activate(admin, licenseKey);
		log(`${combination}: activated the key on the project of the tests in ${seconds(activatingAt)} s`);
	} else if (tiered) {
		const reason =
			licenseKey === undefined
				? 'DIRECTUS_LICENSE_KEY is empty or missing'
				: 'the key of the tests only goes to the database of their project';

		log(`${combination}: runs on the Core tier, because ${reason}`);
	}

	const customPermissionRules = !tiered || (licenseKey !== undefined && activate !== undefined);
	const tokens = await seed(admin, newSecret, customPermissionRules);

	return {
		combination,
		directus: {
			url,
			tokens: { admin: adminToken, ...tokens },
			versions: { directus: images.directus.version, ...(await backend.versions(directus)) },
			customPermissionRules,
		},
		recorded,
		stop: async () => {
			// Time for Directus to shut down and for Node to write the coverage. Without it, Docker kills the container at once.
			await directus.stop({ timeout: 60_000 });
			await backend.stop();
		},
	};
};

const cleanUp = async (started: Started[]) => {
	await Promise.all(started.map(({ stop }) => stop()));
	await Promise.all(started.map(({ recorded }) => rm(recorded, { recursive: true, force: true })));
};

// Vitest runs the global setup of each project one after the other, so this one, at the root, runs once and starts at
// the same time the combinations of every project of the run. Each project finds its own by name (test/directus.ts).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	const selected = project.vitest.projects.flatMap(({ config }) => config.provide.combination ?? []);

	// A run of the unit tests alone starts nothing.
	if (selected.length === 0) {
		return () => Promise.resolve();
	}

	const licenseKey = await readLicenseKey();
	const results = await Promise.allSettled(selected.map((combination) => start(combination, licenseKey)));
	const started = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
	const failure = results.find((result) => result.status === 'rejected');

	if (failure !== undefined) {
		await cleanUp(started);
		throw failure.reason;
	}

	project.provide('directus', Object.fromEntries(started.map(({ combination, directus }) => [combination, directus])));

	return async () => {
		const recorded = Object.fromEntries(started.map(({ combination, recorded }) => [combination, recorded]));

		try {
			await Promise.all(started.map(({ stop }) => stop()));
			await collectCoverage(recorded, new URL('../coverage/integration/coverage-final.json', import.meta.url));
		} finally {
			await Promise.all(started.map(({ recorded }) => rm(recorded, { recursive: true, force: true })));
		}
	};
}

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, type StartedTestContainer, Wait } from 'testcontainers';
import { type Combination, combinations } from './combinations.ts';
import type { Client, DatabaseVersions } from './directus.ts';
import { activateLicense, hasProjectOfTests, publicUrl } from './license.ts';
import { directusDatabase, versionsOf as postgresVersionsOf, query } from './postgres.ts';
import { directusWithSpatialite, versionsOf as sqliteVersionsOf } from './sqlite.ts';

// Where Node writes the coverage of the Directus processes.
const coverageInContainer = '/tmp/v8-coverage';

// The extension, which every Directus of the suite loads. A run can add other packages beside it, by their folder in
// the repository.
export const extension = 'packages/extension';

const repository = new URL('../', import.meta.url);

// A copy of each built package, as an installation has it, in the folder of its name, where Directus loads it from.
const copiesOf = async (packages: readonly string[]) =>
	Promise.all(
		packages.map(async (folder) => {
			const source = new URL(`${folder}/`, repository);
			const { name } = JSON.parse(await readFile(new URL('package.json', source), 'utf8')) as { name: string };
			const target = `/directus/extensions/${name}`;

			return {
				files: { source: fileURLToPath(new URL('package.json', source)), target: `${target}/package.json` },
				directories: { source: fileURLToPath(new URL('dist', source)), target: `${target}/dist` },
			};
		}),
	);

export const newSecret = (): string => randomBytes(32).toString('hex');

export const seconds = (since: number): string => ((performance.now() - since) / 1000).toFixed(1);

export const log = (text: string): void => {
	process.stdout.write(`${text}\n`);
};

// What differs between the databases of the combinations.
interface Backend {
	// Directus, before it starts, and what it needs to reach its database.
	directus: GenericContainer;
	environment: Record<string, string>;
	// The container of the database, when it runs apart from Directus.
	database?: StartedTestContainer;
	versions: (directus: StartedTestContainer) => Promise<DatabaseVersions>;
	// Applies the key of the tests, which only goes to the PostGIS database, under the project the key is bound to. Any
	// other database would be another project, and another activation of the key (D-043, D-044).
	activate?: (admin: Client, key: string) => Promise<void>;
	// Whether the database still has the project of the tests, after a restart of Directus or another one on it.
	hasProjectOfTests?: () => Promise<boolean>;
	stop: () => Promise<void>;
}

const withPostgis = async (directus: string, image: string): Promise<Backend> => {
	const network = await new Network().start();

	const database = await new PostgreSqlContainer(image)
		.withNetwork(network)
		.withNetworkAliases('database')
		.withDatabase(directusDatabase)
		.withUsername(directusDatabase)
		.withPassword(newSecret())
		// pg_stat_statements counts the statements the database runs, for the tests that read how many reached it.
		.withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
		.start();

	await query(database, 'create extension pg_stat_statements');

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
		database,
		versions: () => postgresVersionsOf(database),
		activate: (admin, key) => activateLicense(admin, database, key),
		hasProjectOfTests: () => hasProjectOfTests(database),
		stop: async () => {
			await database.stop();
			await network.stop();
		},
	};
};

// SQLite has no container of its own: Directus opens the file its image points DB_FILENAME to.
const withSqlite = async (name: string, image: DirectusImage): Promise<Backend> => {
	const builtAt = performance.now();
	const directus = await directusWithSpatialite(image);

	log(`${name}: built the image of Directus with SpatiaLite in ${seconds(builtAt)} s`);

	return { directus, environment: {}, versions: sqliteVersionsOf, stop: () => Promise.resolve() };
};

// Where the suite reaches a Directus, by the port Docker mapped, which changes when the container restarts.
const urlOf = (directus: StartedTestContainer): string =>
	`http://${directus.getHost()}:${String(directus.getMappedPort(8055))}`;

export interface Environment {
	directus: StartedTestContainer;
	url: string;
	admin: { email: string; password: string; token: string };
	backend: Backend;
	// Starts another Directus on the same database, with the same configuration, as an installation that scales.
	another: () => Promise<StartedTestContainer>;
	stop: () => Promise<void>;
}

// An image of Directus, by the version it runs, which names the images the suite builds on it.
interface DirectusImage {
	version: string;
	image: string;
}

interface Options {
	// A name for the log. Node writes the coverage of the Directus processes into a folder of that name in the root,
	// which test/coverage.ts reads when the run ends.
	name?: string;
	// The packages Directus loads, by their folder in the repository: the built extension, and any other the run adds.
	packages?: readonly string[];
	// An image of Directus in place of the one of the combination, for a test that changes it.
	directus?: DirectusImage;
}

// Starts the database and the Directus of one combination.
export const startEnvironment = async (
	combination: Combination,
	root: string,
	{ name = combination, packages = [extension], directus: image = combinations[combination].directus }: Options = {},
): Promise<Environment> => {
	const { database } = combinations[combination];

	const backend =
		database.client === 'postgres' ? await withPostgis(image.image, database.image) : await withSqlite(name, image);

	// The container user of Directus writes the coverage here, so the folder is open to any user.
	const coverage = join(root, name);

	await mkdir(coverage);
	await chmod(coverage, 0o777);

	const admin = { email: 'admin@example.com', password: newSecret(), token: newSecret() };
	const copies = await copiesOf(packages);

	const container = backend.directus
		.withEnvironment({
			...backend.environment,
			SECRET: newSecret(),
			ADMIN_EMAIL: admin.email,
			ADMIN_PASSWORD: admin.password,
			ADMIN_TOKEN: admin.token,
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
		// The coverage comes back through a mount.
		.withCopyFilesToContainer(copies.map(({ files }) => files))
		.withCopyDirectoriesToContainer(copies.map(({ directories }) => directories))
		.withBindMounts([{ source: coverage, target: coverageInContainer, mode: 'rw' }])
		.withExposedPorts(8055)
		// /server/health refuses a request without a session from Directus 12 on (V-110).
		.withWaitStrategy(Wait.forHttp('/server/ping', 8055))
		.withStartupTimeout(180_000);

	const instances: StartedTestContainer[] = [];

	const start = async (label: string) => {
		const startedAt = performance.now();
		const instance = await container.start();

		instances.push(instance);
		log(`${label}: Directus started in ${seconds(startedAt)} s`);

		return instance;
	};

	const directus = await start(name);

	return {
		directus,
		url: urlOf(directus),
		admin,
		backend,
		another: () => {
			// SQLite keeps its database inside the container of Directus, so another one would have another database.
			if (backend.database === undefined) {
				return Promise.reject(new Error('Only a database in a container of its own takes another Directus.'));
			}

			return start(`${name}, instance ${String(instances.length + 1)}`);
		},
		stop: async () => {
			// Time for Directus to shut down and for Node to write the coverage. Without it, Docker kills the container at once.
			await Promise.all(instances.map((instance) => instance.stop({ timeout: 60_000 })));
			await backend.stop();
		},
	};
};

// Node writes each file of coverage readable only by the user of the container, the node user of the Directus image
// (V-126). Once every Directus of the run stopped, a container of the same image opens them to the user of the suite,
// whatever its id, on this machine or on a runner of the CI.
export const openCoverage = async (root: string, image: string): Promise<void> => {
	const container = await new GenericContainer(image)
		.withUser('root')
		.withEntrypoint(['chmod', '-R', 'a+rX', '/coverage'])
		.withBindMounts([{ source: root, target: '/coverage', mode: 'rw' }])
		.withWaitStrategy(Wait.forOneShotStartup())
		.start();

	await container.stop();
};

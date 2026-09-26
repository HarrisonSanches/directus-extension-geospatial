import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, type StartedTestContainer, Wait } from 'testcontainers';
import { type Combination, combinations } from './combinations.ts';
import type { Client, DatabaseVersions } from './directus.ts';
import { activateLicense, publicUrl } from './license.ts';
import { versionsOf as postgresVersionsOf } from './postgres.ts';
import { directusWithSpatialite, versionsOf as sqliteVersionsOf } from './sqlite.ts';

// Where Directus loads the extension from, and where Node writes the coverage of the Directus processes.
const extensionInContainer = '/directus/extensions/directus-extension-geospatial';
const coverageInContainer = '/tmp/v8-coverage';

const extension = new URL('../packages/extension/', import.meta.url);

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
		database,
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

export interface Environment {
	directus: StartedTestContainer;
	url: string;
	admin: { email: string; password: string; token: string };
	backend: Backend;
	stop: () => Promise<void>;
}

// Starts the database and the Directus of one combination, with the built extension, under a name for the log. Node
// writes the coverage of the Directus processes into a folder of that name in the root, which test/coverage.ts reads
// when the run ends.
export const startEnvironment = async (
	combination: Combination,
	root: string,
	name: string = combination,
): Promise<Environment> => {
	const images = combinations[combination];

	const backend =
		images.database.client === 'postgres'
			? await withPostgis(images.directus.image, images.database.image)
			: await withSqlite(combination);

	// The container user of Directus writes the coverage here, so the folder is open to any user.
	const coverage = join(root, name);

	await mkdir(coverage);
	await chmod(coverage, 0o777);

	const admin = { email: 'admin@example.com', password: newSecret(), token: newSecret() };
	const startedAt = performance.now();

	const directus = await backend.directus
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
		// A copy of the built package, as an installation has it. The coverage comes back through a mount.
		.withCopyFilesToContainer([
			{ source: fileURLToPath(new URL('package.json', extension)), target: `${extensionInContainer}/package.json` },
		])
		.withCopyDirectoriesToContainer([
			{ source: fileURLToPath(new URL('dist', extension)), target: `${extensionInContainer}/dist` },
		])
		.withBindMounts([{ source: coverage, target: coverageInContainer, mode: 'rw' }])
		.withExposedPorts(8055)
		// /server/health refuses a request without a session from Directus 12 on (V-110).
		.withWaitStrategy(Wait.forHttp('/server/ping', 8055))
		.withStartupTimeout(180_000)
		.start();

	log(`${name}: Directus started in ${seconds(startedAt)} s`);

	return {
		directus,
		url: `http://${directus.getHost()}:${String(directus.getMappedPort(8055))}`,
		admin,
		backend,
		stop: async () => {
			// Time for Directus to shut down and for Node to write the coverage. Without it, Docker kills the container at once.
			await directus.stop({ timeout: 60_000 });
			await backend.stop();
		},
	};
};

import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { collectCoverage } from './coverage.js';
import { connect } from './directus.js';
import { seed } from './seed.js';

// The oldest PostGIS the PostGIS project maintains, on the oldest supported Postgres, in its official image, which
// stopped being rebuilt in 2022 (V-113). Directus 11.17 is the floor of the range (D-037); Directus 12 comes with the
// key of the Open Innovation Grant in F00-06 (D-043).
const images = { postgis: 'postgis/postgis:14-3.2-alpine', directus: 'directus/directus:11.17.4' };

// Where Directus loads the extension from, and where Node writes the coverage of the Directus processes.
const extensionInContainer = '/directus/extensions/directus-extension-geospatial';
const coverageInContainer = '/tmp/v8-coverage';

const extension = new URL('../packages/extension/', import.meta.url);

const newSecret = () => randomBytes(32).toString('hex');

const seconds = (since: number) => ((performance.now() - since) / 1000).toFixed(1);

// Reads the versions the database container runs, as the extension does.
const versionsOf = async (database: Awaited<ReturnType<PostgreSqlContainer['start']>>) => {
	const { output, exitCode } = await database.exec([
		'psql',
		...['--username', database.getUsername(), '--dbname', database.getDatabase(), '--tuples-only', '--no-align'],
		...[
			'--command',
			"select current_setting('server_version'), extversion from pg_extension where extname = 'postgis'",
		],
	]);
	const [postgres, postgis] = output.trim().split('|');

	if (exitCode !== 0 || postgres === undefined || postgis === undefined) {
		throw new Error(`Could not read the versions of the database: ${output}`);
	}

	return { postgres, postgis };
};

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	const network = await new Network().start();

	const database = await new PostgreSqlContainer(images.postgis)
		.withNetwork(network)
		.withNetworkAliases('database')
		.withDatabase('directus')
		.withUsername('directus')
		.withPassword(newSecret())
		.start();

	// The container user of Directus writes the coverage here, so the folder is open to any user.
	const recorded = await mkdtemp(join(tmpdir(), 'geospatial-coverage-'));
	await chmod(recorded, 0o777);

	const adminToken = newSecret();
	const started = performance.now();

	const directus = await new GenericContainer(images.directus)
		.withNetwork(network)
		.withEnvironment({
			DB_CLIENT: 'pg',
			DB_HOST: 'database',
			DB_PORT: '5432',
			DB_DATABASE: database.getDatabase(),
			DB_USER: database.getUsername(),
			DB_PASSWORD: database.getPassword(),
			SECRET: newSecret(),
			ADMIN_EMAIL: 'admin@example.com',
			ADMIN_PASSWORD: newSecret(),
			ADMIN_TOKEN: adminToken,
			// Directus exits if the extension fails to load, instead of answering 404 on its routes.
			EXTENSIONS_MUST_LOAD: 'true',
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

	process.stdout.write(`${images.directus} started in ${seconds(started)} s\n`);

	const url = `http://${directus.getHost()}:${String(directus.getMappedPort(8055))}`;
	const tokens = await seed(connect(url, adminToken), newSecret);

	project.provide('directus', {
		url,
		tokens: { admin: adminToken, ...tokens },
		versions: { directus: images.directus.split(':')[1] ?? '', ...(await versionsOf(database)) },
	});

	return async () => {
		// Time for Directus to shut down and for Node to write the coverage. Without it, Docker kills the container at once.
		await directus.stop({ timeout: 60_000 });
		await collectCoverage(recorded, new URL('../coverage/integration/coverage-final.json', import.meta.url));
		await rm(recorded, { recursive: true, force: true });
		await database.stop();
		await network.stop();
	};
}

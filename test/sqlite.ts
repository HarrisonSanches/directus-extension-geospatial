import { fileURLToPath } from 'node:url';
import { GenericContainer, getContainerRuntimeClient, type StartedTestContainer } from 'testcontainers';
import type { DatabaseVersions } from './directus.ts';

const context = fileURLToPath(new URL('spatialite/', import.meta.url));

// Builds the image of test/spatialite/ on an official image of Directus. The image stays in Docker after the run, so
// the next runs take it from the cache of the build.
export const directusWithSpatialite = (directus: { version: string; image: string }): Promise<GenericContainer> =>
	GenericContainer.fromDockerfile(context)
		.withBuildArgs({ DIRECTUS: directus.image })
		.build(`directus-extension-geospatial-test/directus-spatialite:${directus.version}`, { deleteOnExit: false });

// SQLite and SpatiaLite are libraries inside Directus, so their versions are the same in every connection. This one
// opens its own, in memory, with the driver Directus uses.
const script = `
import { sqlite3 } from '/directus/load-spatialite.ts';

const database = new sqlite3.Database(':memory:', (error) => {
	if (error) throw error;

	database.get('select sqlite_version() as sqlite, spatialite_version() as spatialite', (error, row) => {
		if (error) throw error;

		process.stdout.write(JSON.stringify(row));
	});
});
`;

// The versions the Directus container runs, read with a query as the extension reads them.
export const versionsOf = async (directus: StartedTestContainer): Promise<DatabaseVersions> => {
	const { stdout, output, exitCode } = await directus.exec(['node', '--input-type=module', '--eval', script]);

	if (exitCode !== 0) {
		throw new Error(`Could not read the versions of SQLite and SpatiaLite in the Directus container: ${output}`);
	}

	const { sqlite, spatialite } = JSON.parse(stdout) as { sqlite: string; spatialite: string };

	return { database: { client: 'sqlite', version: sqlite }, spatial: { name: 'spatialite', version: spatialite } };
};

// Runs statements on the SQLite file of a Directus container, one after the other, each in a transaction of its own,
// with the driver Directus uses and SpatiaLite loaded, for the data a test cannot write through the API in time. Directus
// holds the same file, and the sqlite3 driver waits a second for a lock (V-180), so each statement stays short, and this
// connection waits for Directus as long as it takes.
export const runOnSqlite = async (container: string, statements: string[]): Promise<void> => {
	const run = `
import { sqlite3 } from '/directus/load-spatialite.ts';

const statements = ${JSON.stringify(statements)};
const database = new sqlite3.Database(process.env.DB_FILENAME, (error) => {
	if (error) throw error;

	database.configure('busyTimeout', 60000);

	const next = (index) => {
		if (index === statements.length) {
			database.close();

			return;
		}

		database.exec(statements[index], (error) => {
			if (error) throw error;

			next(index + 1);
		});
	};

	next(0);
});
`;
	const runtime = await getContainerRuntimeClient();
	const { output, exitCode } = await runtime.container.exec(runtime.container.getById(container), [
		'node',
		'--input-type=module',
		'--eval',
		run,
	]);

	if (exitCode !== 0) {
		throw new Error(`The statements failed on the SQLite file of Directus: ${output}`);
	}
};

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { getContainerRuntimeClient } from 'testcontainers';
import type { DatabaseVersions } from './directus.ts';

// The database and the user of Directus in the PostGIS container of the suite (test/environment.ts).
export const directusDatabase = 'directus';

// Runs a query with psql inside the database container, and returns the rows as text: one per line, with the columns
// separated by |.
export const query = async (database: StartedPostgreSqlContainer, sql: string): Promise<string> => {
	const { output, exitCode } = await database.exec([
		'psql',
		...['--username', database.getUsername(), '--dbname', database.getDatabase(), '--tuples-only', '--no-align'],
		...['--set', 'ON_ERROR_STOP=1', '--command', sql],
	]);

	if (exitCode !== 0) {
		throw new Error(`The query failed in the database container: ${output}`);
	}

	return output.trim();
};

// The versions the database container runs, read as the extension reads them.
export const versionsOf = async (database: StartedPostgreSqlContainer): Promise<DatabaseVersions> => {
	const output = await query(
		database,
		"select current_setting('server_version'), extversion from pg_extension where extname = 'postgis'",
	);
	const [postgres, postgis] = output.split('|');

	if (postgres === undefined || postgis === undefined) {
		throw new Error(`Could not read the versions of the database: ${output}`);
	}

	return { database: { client: 'postgres', version: postgres }, spatial: { name: 'postgis', version: postgis } };
};

// Runs a query with psql inside the database container of a combination, by the id of the container, which the global
// setup hands to the tests, and returns the rows as text, as query does. Several commands run one after the other, in
// the same connection, each a query or a command of psql.
export const queryOn = async (container: string, commands: string | readonly string[]): Promise<string> => {
	const runtime = await getContainerRuntimeClient();
	const { output, exitCode } = await runtime.container.exec(runtime.container.getById(container), [
		'psql',
		...['--username', directusDatabase, '--dbname', directusDatabase, '--tuples-only', '--no-align'],
		...['--set', 'ON_ERROR_STOP=1', ...[commands].flat().flatMap((command) => ['--command', command])],
	]);

	if (exitCode !== 0) {
		throw new Error(`The query failed in the database container: ${output}`);
	}

	return output.trim();
};

// How many times Postgres ran the statements whose text holds a piece, as pg_stat_statements counts them, with the
// values of each statement apart from its text. The suite loads it in each PostGIS container.
export const callsOn = async (container: string, piece: string): Promise<number> => {
	const literal = `'${piece.replaceAll("'", "''")}'`;

	return Number(
		await queryOn(
			container,
			`select coalesce(sum(calls), 0) from pg_stat_statements where strpos(query, ${literal}) > 0`,
		),
	);
};

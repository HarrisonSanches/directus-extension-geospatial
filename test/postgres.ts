import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

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
export const versionsOf = async (
	database: StartedPostgreSqlContainer,
): Promise<{ postgres: string; postgis: string }> => {
	const output = await query(
		database,
		"select current_setting('server_version'), extversion from pg_extension where extname = 'postgis'",
	);
	const [postgres, postgis] = output.split('|');

	if (postgres === undefined || postgis === undefined) {
		throw new Error(`Could not read the versions of the database: ${output}`);
	}

	return { postgres, postgis };
};

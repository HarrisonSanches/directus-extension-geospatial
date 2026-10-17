import type { ApiExtensionContext } from '@directus/types';
import type { Logger } from 'pino';
import { knexClassOf } from '../db/client.js';
import { failClosed } from '../db/fail-closed.js';
import { type Query, readVersions } from '../db/versions.js';
import { databaseClientOf, type Detected } from './detect.js';

type Knex = ApiExtensionContext['database'];

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// knex.raw returns the rows as an array in SQLite, and inside rows in Postgres.
const queryOf =
	(database: Knex): Query =>
	async (sql) => {
		const result: unknown = await database.raw(sql);
		const rows = isRow(result) && 'rows' in result ? result.rows : result;

		return Array.isArray(rows) ? rows.filter(isRow) : [];
	};

interface Startup {
	database: Knex;
	logger: Pick<Logger, 'info' | 'error'>;
	// Runs the SQL of the detection, which a test answers with a database of its own.
	query?: Query;
}

// Detects the database once for the process, when the extension loads: the client, its version and the version of its
// spatial extension, which the capabilities and every operation read, so they always tell the same (§ capability
// matrix, A-050). A spatial extension installed after the start counts after a restart, until the health panel detects
// again. While the database does not answer, a read fails closed, and the next one detects again.
export const detectOnStartup = ({
	database,
	logger,
	query = queryOf(database),
}: Startup): (() => Promise<Detected>) => {
	const client = databaseClientOf(knexClassOf(database));
	let detecting: Promise<Detected> | undefined;

	const detected = () => {
		detecting ??= failClosed(async () => {
			const found = { client, ...(await readVersions(client, query)) };

			logger.info(found, 'Detected the database of Directus');

			return found;
		}, logger).catch((error: unknown) => {
			detecting = undefined;

			throw error;
		});

		return detecting;
	};

	// The cause of a failure is already in the log, from failClosed.
	detected().catch(() => undefined);

	return detected;
};

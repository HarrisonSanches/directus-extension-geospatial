import { InternalServerError } from '@directus/errors';
import type { Accountability, ApiExtensionContext } from '@directus/types';
import { apiVersion, type Capabilities } from 'directus-geospatial-contract';
import packageJson from '../../package.json' with { type: 'json' };
import { databaseClientOf, detectCapabilities } from '../capabilities/detect.js';
import { viewerOf, visibleTo } from '../capabilities/visible.js';
import { knexClassOf } from '../db/client.js';
import { type Query, readVersions } from '../db/versions.js';

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

// The version Directus itself reports in /server/info, which any user with a session can read.
const directusVersionOf = async (context: ApiExtensionContext, accountability: Accountability | undefined) => {
	const server = new context.services.ServerService({ schema: await context.getSchema(), accountability });
	const info: Record<string, unknown> = await server.serverInfo();

	if (typeof info.version !== 'string') {
		throw new InternalServerError();
	}

	return info.version;
};

export const readCapabilities = async (
	context: ApiExtensionContext,
	accountability: Accountability | undefined,
): Promise<Capabilities | 'forbidden'> => {
	const viewer = viewerOf(accountability);

	if (viewer === 'anonymous') {
		return 'forbidden';
	}

	const client = databaseClientOf(knexClassOf(context.database));

	const [versions, directusVersion] = await Promise.all([
		readVersions(client, queryOf(context.database)),
		directusVersionOf(context, accountability),
	]);

	const capabilities = detectCapabilities({
		client,
		...versions,
		directusVersion,
		extensionVersion: packageJson.version,
		apiVersion,
	});

	return visibleTo(capabilities, viewer);
};

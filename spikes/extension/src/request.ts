import { performance } from 'node:perf_hooks';
import emitter from '@directus/api/emitter';
import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query } from '@directus/types';
import type { Knex } from 'knex';
import { adapterFor } from './check.js';
import { permittedQuery } from './permitted-query.js';

// What a route of the spikes asks of the permitted query: whose, of which collection, and with which page.
export interface PermittedRequest {
	collection: string;
	// The fields, the filter and the search of the page, as the /items receives them (F01-03).
	page: Query;
	accountability: Accountability | null;
	// The adapter the request forces, instead of the one the running Directus passes (F01-06).
	adapter: string | undefined;
}

export interface Permitted {
	builder: Knex.QueryBuilder;
	// Whether a read rule of whoever asks uses $NOW, which changes the values on each request (V-55).
	usesNow: boolean;
	// The adapter that built the permitted query (F01-06).
	adapter: string;
	// The time to build the permitted query, the schema and the hooks included, in milliseconds.
	buildMs: number;
}

// Knex types its client as any. The name of its class tells the database, as getDatabaseClient of Directus reads it
// (V-105).
export const clientOf = ({ client }: { client: unknown }): string =>
	typeof client === 'object' && client !== null ? client.constructor.name : '';

// Knex returns the rows untyped.
export const isRow = (row: unknown): row is Record<string, unknown> => typeof row === 'object' && row !== null;

export const numberOf = (value: unknown, name: string): number => {
	const number = Number(value);

	if (typeof value !== 'string' || !Number.isFinite(number)) {
		throw new InvalidQueryError({ reason: `${name} must be a number` });
	}

	return number;
};

export const permittedRequestOf = (
	collection: string,
	query: Record<string, unknown>,
	page: Query | undefined,
	accountability: Accountability | undefined,
): PermittedRequest => ({
	collection,
	page: page ?? {},
	accountability: accountability ?? null,
	adapter: typeof query.adapter === 'string' ? query.adapter : undefined,
});

// Every query that reads the collection from now on, as it reached the database, until the stop. Postgres and
// CockroachDB quote the names with double quotes, SQLite, MySQL and MariaDB with backticks, and SQL Server with brackets.
export const watchQueries = (knex: Knex, collection: string): { executed: string[]; stop: () => void } => {
	const executed: string[] = [];

	const record = ({ sql }: { sql: string }) => {
		if ([`"${collection}"`, `\`${collection}\``, `[${collection}]`].some((quoted) => sql.includes(quoted))) {
			executed.push(sql);
		}
	};

	knex.on('query', record);

	return { executed, stop: () => knex.off('query', record) };
};

// The permitted query of whoever asks, as the ItemsService of the running Directus builds it (D-001), with the query
// each route reads out of the page once the hooks changed it.
//
// The builder goes back inside an object. It has a then of its own, so a promise that resolved to it would take it as
// a promise and run the query (V-142).
export const permittedFor = async (
	{ collection, page, accountability, adapter: forced }: PermittedRequest,
	context: ApiExtensionContext,
	queryOf: (hooked: Query) => Query,
): Promise<Permitted> => {
	const knex = context.database;
	const startedAt = performance.now();
	const schema = await context.getSchema();

	// The internals of the running Directus pass the adapter before anything reads or builds a query, or the route fails
	// closed (§5, protection 2).
	const adapter = await adapterFor(forced, { schema, knex }, context.logger);

	await adapter.beforeHooks({ collection, accountability }, { schema, knex });

	// The hooks of other extensions change the query as the ItemsService lets them, before the chain: the same events,
	// in the same order, on the page as the /items hands it over (F01-04).
	const hooked = await emitter.emitFilter(
		['items.query', `${collection}.items.query`],
		page,
		{ collection },
		{ database: knex, schema, accountability },
	);

	const { builder, usesNow } = await permittedQuery(
		{ collection, query: queryOf(hooked), accountability },
		{ schema, knex },
	);

	return { builder, usesNow, adapter: adapter.name, buildMs: performance.now() - startedAt };
};

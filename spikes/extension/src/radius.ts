import { performance } from 'node:perf_hooks';
import emitter from '@directus/api/emitter';
import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query } from '@directus/types';
import { adapterFor } from './check.js';
import { permittedQuery } from './permitted-query.js';

export interface Radius {
	// The ids inside the circle, in order.
	ids: number[];
	// The items inside the circle, with the fields of the permitted query, as the database returns them.
	items: Record<string, unknown>[];
	// Every query that read the collection during the request, as it reached the database.
	executed: string[];
	// The time to build the permitted query, the schema and the hooks included, in milliseconds.
	buildMs: number;
	// The permitted query as Knex compiles it, with the text and the values apart, the base of the cache key (F01-05).
	permitted: { sql: string; bindings: unknown[] };
	// Whether a read rule of whoever asks uses $NOW, which changes the values on each request (V-55).
	usesNow: boolean;
	// The adapter that built the permitted query (F01-06).
	adapter: string;
}

interface RadiusRequest {
	collection: string;
	longitude: number;
	latitude: number;
	meters: number;
	// The fields, the filter and the search of the page, as the /items receives them (F01-03).
	page: Query;
	accountability: Accountability | null;
	// The adapter the request forces, instead of the one the running Directus passes (F01-06).
	adapter: string | undefined;
}

// Knex returns the rows untyped.
const isRow = (row: unknown): row is Record<string, unknown> => typeof row === 'object' && row !== null;

const idOf = (row: Record<string, unknown>): number => {
	if (typeof row.id === 'number') {
		return row.id;
	}

	throw new Error('A row of the envelope has no numeric id.');
};

const numberOf = (value: unknown, name: string): number => {
	const number = Number(value);

	if (typeof value !== 'string' || !Number.isFinite(number)) {
		throw new InvalidQueryError({ reason: `${name} must be a number` });
	}

	return number;
};

export const radiusRequestOf = (
	collection: string,
	query: Record<string, unknown>,
	page: Query | undefined,
	accountability: Accountability | undefined,
): RadiusRequest => ({
	collection,
	longitude: numberOf(query.longitude, 'longitude'),
	latitude: numberOf(query.latitude, 'latitude'),
	meters: numberOf(query.meters, 'meters'),
	page: page ?? {},
	accountability: accountability ?? null,
	adapter: typeof query.adapter === 'string' ? query.adapter : undefined,
});

// The items of the collection within a distance of a point, in meters over the ellipsoid, out of the permitted query
// of whoever asks (D-001), in one SQL (F01-02).
export const radius = async (
	{ collection, longitude, latitude, meters, page, accountability, adapter: forced }: RadiusRequest,
	context: ApiExtensionContext,
): Promise<Radius> => {
	const knex = context.database;
	const executed: string[] = [];

	const record = ({ sql }: { sql: string }) => {
		if (sql.includes(`"${collection}"`)) {
			executed.push(sql);
		}
	};

	knex.on('query', record);

	try {
		const startedAt = performance.now();
		const schema = await context.getSchema();

		// The internals of the running Directus pass the adapter before anything reads or builds a query, or the radius
		// fails closed (§5, protection 2).
		const adapter = await adapterFor(forced, { schema, knex }, context.logger);

		await adapter.beforeHooks({ collection, accountability }, { schema, knex });

		// The hooks of other extensions change the query as the ItemsService lets them, before the chain: the same
		// events, in the same order, on the page as the /items hands it over (F01-04).
		const hooked = await emitter.emitFilter(
			['items.query', `${collection}.items.query`],
			page,
			{ collection },
			{ database: knex, schema, accountability },
		);

		// The geometry goes by its name, so a role that cannot read it gets the error of the /items, instead of the field
		// quietly missing from the *. The limit of -1 lifts QUERY_LIMIT_DEFAULT, which getDBQuery applies otherwise.
		const query: Query = { ...hooked, fields: [...(hooked.fields ?? ['*']), 'geometry'], limit: -1 };
		const { builder: permitted, usesNow } = await permittedQuery(
			{ collection, query, accountability },
			{ schema, knex },
		);

		const buildMs = performance.now() - startedAt;

		// Before the envelope, which gives the permitted query an alias of its own.
		const { sql, bindings } = permitted.toSQL();

		// The permitted query selects the geometry as text, through st_astext, and case whens that leave it null where a
		// policy lets the item through without the field. The envelope reads that value, and never the column itself.
		const rows: unknown[] = await knex
			.select('p.*')
			.from(permitted.as('p'))
			.whereRaw(
				'ST_DWithin(ST_GeomFromText(??, 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)',
				['p.geometry', longitude, latitude, meters],
			)
			.orderBy('p.id');

		const items = rows.filter(isRow);

		return {
			ids: items.map(idOf),
			items,
			executed,
			buildMs,
			permitted: { sql, bindings: [...bindings] },
			usesNow,
			adapter: adapter.name,
		};
	} finally {
		knex.off('query', record);
	}
};

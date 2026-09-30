import type { Accountability, ApiExtensionContext, Query } from '@directus/types';
import {
	clientOf,
	isRow,
	numberOf,
	permittedFor,
	type PermittedRequest,
	permittedRequestOf,
	watchQueries,
} from './request.js';

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

interface RadiusRequest extends PermittedRequest {
	longitude: number;
	latitude: number;
	meters: number;
}

// The spatial part around the permitted query, in the dialect of each database, with the permitted geometry, the
// longitude, the latitude and the meters as its values. Both read the geometry the permitted query exposes, as text,
// and never the column itself (A-023).
const envelopes: Readonly<Record<string, string>> = {
	// PostGIS, over the ellipsoid through geography (F01-02).
	Client_PG: 'ST_DWithin(ST_GeomFromText(??, 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)',
	// SpatiaLite, over the ellipsoid with the last argument at 1. Directus creates no spatial metadata, and PtDistWithin is
	// the distance in meters that needs none (V-147).
	Client_SQLite3: 'PtDistWithin(ST_GeomFromText(??, 4326), MakePoint(?, ?, 4326), ?, 1)',
};

const idOf = (row: Record<string, unknown>): number => {
	if (typeof row.id === 'number') {
		return row.id;
	}

	throw new Error('A row of the envelope has no numeric id.');
};

export const radiusRequestOf = (
	collection: string,
	query: Record<string, unknown>,
	page: Query | undefined,
	accountability: Accountability | undefined,
): RadiusRequest => ({
	...permittedRequestOf(collection, query, page, accountability),
	longitude: numberOf(query.longitude, 'longitude'),
	latitude: numberOf(query.latitude, 'latitude'),
	meters: numberOf(query.meters, 'meters'),
});

// The items of the collection within a distance of a point, in meters over the ellipsoid, out of the permitted query
// of whoever asks (D-001), in one SQL (F01-02).
export const radius = async (request: RadiusRequest, context: ApiExtensionContext): Promise<Radius> => {
	const knex = context.database;
	const envelope = envelopes[clientOf(knex)];

	if (envelope === undefined) {
		throw new Error(`The spikes have no envelope for the database of ${clientOf(knex)}.`);
	}

	const { longitude, latitude, meters } = request;
	const watch = watchQueries(knex, request.collection);

	try {
		// The geometry goes by its name, so a role that cannot read it gets the error of the /items, instead of the field
		// quietly missing from the *. The limit of -1 lifts QUERY_LIMIT_DEFAULT, which getDBQuery applies otherwise.
		const {
			builder: permitted,
			usesNow,
			adapter,
			buildMs,
		} = await permittedFor(request, context, (hooked) => ({
			...hooked,
			fields: [...(hooked.fields ?? ['*']), 'geometry'],
			limit: -1,
		}));

		// Before the envelope, which gives the permitted query an alias of its own.
		const { sql, bindings } = permitted.toSQL();

		// The permitted query selects the geometry as text, through st_astext, and case whens that leave it null where a
		// policy lets the item through without the field. The envelope reads that value, and never the column itself.
		const rows: unknown[] = await knex
			.select('p.*')
			.from(permitted.as('p'))
			.whereRaw(envelope, ['p.geometry', longitude, latitude, meters])
			.orderBy('p.id');

		const items = rows.filter(isRow);

		return {
			ids: items.map(idOf),
			items,
			executed: watch.executed,
			buildMs,
			permitted: { sql, bindings: [...bindings] },
			usesNow,
			adapter,
		};
	} finally {
		watch.stop();
	}
};

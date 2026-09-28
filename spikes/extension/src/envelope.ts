import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query } from '@directus/types';
import { clientOf, isRow, permittedFor, type PermittedRequest, permittedRequestOf, watchQueries } from './request.js';

export interface Envelope {
	// How many permitted items touch the polygon, by the count of the database.
	count: number;
	// The type of the count as the driver of the database handed it over, before it became a number.
	countAs: string;
	// The ids of the permitted items that touch the polygon, in order.
	ids: number[];
	// Every query that read the collection during the request, as it reached the database.
	executed: string[];
	// The permitted query as Knex compiles it, with the text and the values apart.
	permitted: { sql: string; bindings: unknown[] };
	// The adapter that built the permitted query (F01-06).
	adapter: string;
}

interface EnvelopeRequest extends PermittedRequest {
	// The area, in WKT, with its coordinates in longitude and latitude.
	polygon: string;
}

// The spatial predicate of each database around the permitted query, with the permitted geometry and the polygon as
// its values: whether the item touches the area, the question of the _intersects filter of Directus (V-49). It reads
// the geometry the permitted query exposes, as text, and never the column itself (A-023).
const predicates: Readonly<Record<string, string>> = {
	// CockroachDB takes the functions of PostGIS, on the plane of the coordinates, as Directus writes to it (V-27).
	Client_CockroachDB: 'ST_Intersects(ST_GeomFromText(??, 4326), ST_GeomFromText(?, 4326))',
	// MySQL, on the plane as well. Directus writes the geometry without an SRID, so its SRID is 0, and a predicate takes
	// two geometries of the same SRID: the polygon goes without one too (V-151).
	Client_MySQL2: 'ST_Intersects(ST_GeomFromText(??), ST_GeomFromText(?))',
};

// A driver may hand a bigint, such as a count, over as text.
const integerOf = (value: unknown, name: string): number => {
	const number = typeof value === 'string' ? Number(value) : value;

	if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
		throw new Error(`A row of the envelope has no integer ${name}.`);
	}

	return number;
};

export const envelopeRequestOf = (
	collection: string,
	query: Record<string, unknown>,
	page: Query | undefined,
	accountability: Accountability | undefined,
): EnvelopeRequest => {
	if (typeof query.polygon !== 'string' || query.polygon.trim() === '') {
		throw new InvalidQueryError({ reason: 'polygon must be a WKT polygon' });
	}

	return { ...permittedRequestOf(collection, query, page, accountability), polygon: query.polygon };
};

// The minimal envelope of a database outside the suite (D-002): the permitted query of whoever asks as a derived table,
// with a count and a spatial predicate of the database around it (F01-08). Unlike the radius, the envelope keeps the
// sort and the limit of the page, so both reach the database inside the derived table.
export const envelope = async (request: EnvelopeRequest, context: ApiExtensionContext): Promise<Envelope> => {
	const knex = context.database;
	const predicate = predicates[clientOf(knex)];

	if (predicate === undefined) {
		throw new Error(`The spikes have no envelope for the database of ${clientOf(knex)}.`);
	}

	const watch = watchQueries(knex, request.collection);

	try {
		// The geometry goes by its name, as in the radius. Without a limit of the page, the limit of -1 lifts
		// QUERY_LIMIT_DEFAULT, which getDBQuery applies otherwise.
		const { builder: permitted, adapter } = await permittedFor(request, context, (hooked) => ({
			...hooked,
			fields: ['id', 'geometry'],
			limit: hooked.limit ?? -1,
		}));

		// Before the envelopes, which give the permitted query an alias of its own.
		const { sql, bindings } = permitted.toSQL();
		const values = ['p.geometry', request.polygon];

		const counted: unknown[] = await knex.count('* as count').from(permitted.as('p')).whereRaw(predicate, values);
		const rows: unknown[] = await knex
			.select('p.id')
			.from(permitted.as('p'))
			.whereRaw(predicate, values)
			.orderBy('p.id');

		const [total] = counted.filter(isRow);

		return {
			count: integerOf(total?.count, 'count'),
			countAs: typeof total?.count,
			ids: rows.filter(isRow).map((row) => integerOf(row.id, 'id')),
			executed: watch.executed,
			permitted: { sql, bindings: [...bindings] },
			adapter,
		};
	} finally {
		watch.stop();
	}
};

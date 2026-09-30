import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query } from '@directus/types';
import type { Knex } from 'knex';
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
	// MySQL and MariaDB, which Directus reaches through the same client, on the plane as well. Directus writes the
	// geometry without an SRID, so its SRID is 0, and in MySQL a predicate takes two geometries of the same SRID: the
	// polygon goes without one too (V-151, V-152).
	Client_MySQL2: 'ST_Intersects(ST_GeomFromText(??), ST_GeomFromText(?))',
	// SQL Server reads the text as the type of the column, geometry, on the plane and with the SRID Directus writes
	// (V-27). Its predicates are methods of the type that answer a bit (V-49).
	Client_MSSQL: 'geometry::STGeomFromText(??, 4326).STIntersects(geometry::STGeomFromText(?, 4326)) = 1',
	// Oracle takes SRID 4326 as geodetic, with the sides of a polygon along geodesics, so the envelope compares on the
	// plane, without an SRID, as PostGIS does on a geometry, with a tolerance in the units of the coordinates. The text
	// goes through from_wktgeometry, since the constructor of sdo_geometry takes no null SRID, and the function answers
	// the name of the relation (V-154).
	Client_Oracledb:
		"sdo_geom.relate(sdo_util.from_wktgeometry(??), 'anyinteract', sdo_util.from_wktgeometry(?), 0.000000001) = 'TRUE'",
};

// Knex keeps the limit and the offset of a builder in _single, which its compilers read and its types leave out.
const isPaged = (builder: Knex.QueryBuilder): boolean => {
	const single: unknown = Reflect.get(builder, '_single');

	return isRow(single) && (single.limit !== undefined || single.offset !== undefined);
};

// SQL Server takes no order by in a derived table without a top or an offset beside it (error 1033). Directus gives SQL
// Server a top on the query that takes the limit, the largest safe integer where the page has none, but a filter across
// a relation to many puts the limit on an inner query and the order on the wrapper around it (getDBQuery). An order
// without a top or an offset beside it never changes the rows, so the envelope takes it out, as EF Core does when it
// pushes a query down into a subquery (V-153).
const dropLooseOrder = (builder: Knex.QueryBuilder, client: string): void => {
	if (client === 'Client_MSSQL' && !isPaged(builder)) {
		builder.clear('order');
	}
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

		// Before the envelopes, which give the permitted query an alias of its own, and as Directus built it.
		const { sql, bindings } = permitted.toSQL();
		const values = ['p.geometry', request.polygon];

		dropLooseOrder(permitted, clientOf(knex));

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

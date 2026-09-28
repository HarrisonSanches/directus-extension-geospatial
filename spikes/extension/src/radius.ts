import { performance } from 'node:perf_hooks';
import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext } from '@directus/types';
import { permittedQuery } from './permitted-query.js';

export interface Radius {
	// The ids inside the circle, in order.
	ids: number[];
	// Every query that read the collection during the request, as it reached the database.
	executed: string[];
	// The time to build the permitted query, the schema included, in milliseconds.
	buildMs: number;
}

interface RadiusRequest {
	collection: string;
	longitude: number;
	latitude: number;
	meters: number;
	accountability: Accountability | null;
}

// Knex returns the rows untyped.
const idOf = (row: unknown): number => {
	if (typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'number') {
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
	accountability: Accountability | undefined,
): RadiusRequest => ({
	collection,
	longitude: numberOf(query.longitude, 'longitude'),
	latitude: numberOf(query.latitude, 'latitude'),
	meters: numberOf(query.meters, 'meters'),
	accountability: accountability ?? null,
});

// The items of the collection within a distance of a point, in meters over the ellipsoid, out of the permitted query
// of whoever asks (D-001), in one SQL (F01-02).
export const radius = async (
	{ collection, longitude, latitude, meters, accountability }: RadiusRequest,
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

		// The limit of -1 lifts the default one, QUERY_LIMIT_DEFAULT, which getDBQuery applies to a query with no limit.
		const { builder: permitted } = await permittedQuery(
			{ collection, query: { fields: ['id', 'geometry'], limit: -1 }, accountability },
			{ schema, knex },
		);

		const buildMs = performance.now() - startedAt;

		// The permitted query selects the geometry as text, through st_astext, and case whens that leave it null where a
		// policy lets the item through without the field. The envelope reads that value, and never the column itself.
		const rows: unknown[] = await knex
			.select('p.id')
			.from(permitted.as('p'))
			.whereRaw(
				'ST_DWithin(ST_GeomFromText(??, 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)',
				['p.geometry', longitude, latitude, meters],
			)
			.orderBy('p.id');

		return { ids: rows.map(idOf), executed, buildMs };
	} finally {
		knex.off('query', record);
	}
};

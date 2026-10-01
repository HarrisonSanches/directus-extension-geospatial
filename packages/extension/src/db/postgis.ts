import type { SpatialAdapter } from './adapter.js';

// The adapter of PostGIS, the reference of the catalog (D-002).
export const postgis: SpatialAdapter = {
	// The distance over the ellipsoid, through geography (V-42). The envelope reads the geometry the permitted query
	// exposes, as text, and never the column: the case when of a policy leaves it null where the item goes through
	// without the field, and reading the column would leak its position (V-142, V-143). That text takes no index yet
	// (A-023). The rows go out with the columns of the permitted query, the geometry still as text, which Directus turns
	// into GeoJSON as it does for /items (V-173).
	radius: (knex, { permitted, geometry, key, center: [longitude, latitude], distance, limit, offset }) => {
		const builder = knex
			.select('p.*')
			.from(permitted.as('p'))
			.whereRaw(
				'ST_DWithin(ST_GeomFromText(??, 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)',
				[`p.${geometry}`, longitude, latitude, distance],
			)
			.orderBy(`p.${key}`);

		if (limit !== null) {
			builder.limit(limit);
		}

		if (offset > 0) {
			builder.offset(offset);
		}

		return { builder };
	},
};

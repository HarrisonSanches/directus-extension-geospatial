import type { SpatialAdapter } from './adapter.js';

// The column the envelope adds with the geometry in GeoJSON. A field of Directus never starts with $, as $meta does not
// (V-13).
const geojson = '$geojson';

// The adapter of PostGIS, the reference of the catalog (D-002).
export const postgis: SpatialAdapter = {
	// The distance over the ellipsoid, through geography (V-42). The envelope reads the geometry the permitted query
	// exposes, as text, and never the column: the case when of a policy leaves it null where the item goes through
	// without the field, and reading the column would leak its position (V-142, V-143). That text takes no index yet
	// (A-023). The GeoJSON keeps 15 decimals, as the text of the permitted query has them.
	radius: (knex, { permitted, geometry, key, center: [longitude, latitude], distance, limit, offset }) => {
		const builder = knex
			.select('p.*', knex.raw('ST_AsGeoJSON(ST_GeomFromText(??, 4326), 15)::json as ??', [`p.${geometry}`, geojson]))
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

		return {
			builder,
			itemOf: ({ [geojson]: shape, ...item }) => ({ ...item, [geometry]: shape }),
		};
	},
};

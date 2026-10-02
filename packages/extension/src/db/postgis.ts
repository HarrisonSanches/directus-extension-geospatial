import type { SpatialAdapter } from './adapter.js';
import { boxesOf } from './box.js';

// The adapter of PostGIS, the reference of the catalog (D-002).
export const postgis: SpatialAdapter = {
	// The filter in two stages, both on the column, as more conditions of the permitted query (D-049): the box, which the
	// GiST answers, and the distance over the ellipsoid, through geography (D-007, V-42). Directus orders every permitted
	// query, which keeps Postgres from pulling it up, so a condition around it never reaches the index (V-177). The
	// conditions only discard rows, and what goes out is still decided by the value the permitted query exposes: the case
	// when of a policy leaves it null where the item goes through without the field, and those items stay out (V-142,
	// V-143). The rows keep the columns of the permitted query, the geometry still as text, which Directus turns into
	// GeoJSON as it does for /items (V-173).
	radius: (knex, { permitted, collection, geometry, key, center, distance, limit, offset }) => {
		const column = `${collection}.${geometry}`;
		const [longitude, latitude] = center;
		const boxes = boxesOf(center, distance);
		const near = permitted.clone();

		if (boxes !== null) {
			near.andWhere((inBox) => {
				for (const box of boxes) {
					inBox.orWhereRaw('?? && ST_MakeEnvelope(?, ?, ?, ?, 4326)', [column, ...box]);
				}
			});
		}

		near.andWhereRaw('ST_DWithin(??::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)', [
			column,
			longitude,
			latitude,
			distance,
		]);

		const builder = knex.select('p.*').from(near.as('p')).whereNotNull(`p.${geometry}`).orderBy(`p.${key}`);

		if (limit !== null) {
			builder.limit(limit);
		}

		if (offset > 0) {
			builder.offset(offset);
		}

		return { builder };
	},
};

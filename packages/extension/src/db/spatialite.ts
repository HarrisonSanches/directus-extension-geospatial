import type { CircleEnvelope, SelectingAdapter } from './adapter.js';
import { type OrderKey, pastKeys } from './keyset.js';

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// Whether the column, from its row of pragma_table_info, holds points: Directus declares it with the subtype of the
// field, and a geometry of any type as geometry (V-180).
export const holdsPoints = (result: unknown): boolean => {
	const [row] = Array.isArray(result) ? result.filter(isRow) : [];

	return typeof row?.type === 'string' && row.type.toLowerCase() === 'point';
};

// The permitted query with the distance over the ellipsoid, on the column, as one more of its conditions, as in PostGIS
// (D-049), so the edge keeps the precision of SpatiaLite, and not the 6 decimals of the text the permitted query exposes
// (A-026).
const nearOf = ({ permitted, collection, geometry, center: [longitude, latitude], distance }: CircleEnvelope) =>
	permitted
		.clone()
		.andWhereRaw('PtDistWithin(??, MakePoint(?, ?, 4326), ?, 1)', [
			`${collection}.${geometry}`,
			longitude,
			latitude,
			distance,
		]);

// The adapter of SQLite with SpatiaLite, which Directus never loads by itself (V-121), and whose spatial metadata it
// never creates (V-147). Without them, no function of SpatiaLite measures in meters, and the PtDistWithin, which
// needs none, tells over the ellipsoid whether two points are within a distance, to the millimeter. Between a point
// and a line or a polygon, it measures in degrees, so it only measures points (V-180).
export const spatialite: SelectingAdapter = {
	// Directus writes every geometry in 4326 (V-25), and the database keeps no metadata that could say otherwise.
	columnOf: () => Promise.resolve({ type: 'geometry', srid: 4326 }),

	// Without the metadata, there is no spatial index for a box to reach.
	boxesIn: () => Promise.resolve(null),

	measures: async (knex, collection, field) =>
		holdsPoints(await knex.raw('select type from pragma_table_info(?) where name = ?', [collection, field])),

	// The circle, as one more condition of the permitted query (nearOf). What goes out is still decided by the value the
	// permitted query exposes: the case when of a policy leaves it null where the item goes through without the field,
	// and those items stay out (V-143). Without an order of the page, the rows come by the primary key, for the server to
	// measure and order them.
	radius: (knex, envelope) => {
		const { geometry, key, order, limit, offset, after } = envelope;
		const builder = knex.select('p.*').from(nearOf(envelope).as('p')).whereNotNull(`p.${geometry}`);

		for (const { field, direction } of order) {
			builder.orderBy(`p.${field}`, direction);
		}

		builder.orderBy(`p.${key}`).limit(limit);

		if (offset > 0) {
			builder.offset(offset);
		}

		// With an order of the page, the keys of the order, as the cursor of the next page carries them (D-054): each one
		// as SQLite hands it, so a number goes back as a number and a text as a text, and they compare as the order did.
		// SQLite takes an empty value as the smallest. In the natural order, the server orders the list, and its keys.
		const keys: OrderKey[] =
			order.length === 0
				? []
				: [
						...order.map(({ field, direction }): OrderKey => ({
							column: knex.raw('??', [`p.${field}`]),
							direction,
							nullable: true,
						})),
						{ column: knex.raw('??', [`p.${key}`]), direction: 'asc', nullable: false },
					];
		const keyColumns = keys.map(({ column }, index) => {
			const name = `geospatial:key:${String(index)}`;

			builder.select(knex.raw('? as ??', [column, name]));

			return name;
		});

		if (after !== undefined) {
			pastKeys(builder, keys, after, 'smallest');
		}

		return { builder, keys: keyColumns };
	},

	// The items of the circle whose geometry the permitted query exposes, as the radius gives them, without its order,
	// which only costs a count and changes none of its rows. SQLite bounds no statement in time, and the knex of Directus
	// holds a single connection to it, so no count runs without a limit in the background (D-056).
	count: (knex, envelope, limit) => {
		const inside = knex
			.select(knex.raw('1'))
			.from(nearOf(envelope).clearOrder().as('p'))
			.whereNotNull(`p.${envelope.geometry}`);

		if (limit !== undefined) {
			inside.limit(limit);
		}

		return knex.count({ count: '*' }).from(inside.as('c'));
	},
};

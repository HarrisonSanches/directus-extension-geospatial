import type { Position } from 'directus-geospatial-contract';
import type { MeasuringAdapter, SpatialColumn } from './adapter.js';
import { type Box, boxesOf, ringOf } from './box.js';

// The SRID of what comes in, the center of a request, and of what goes out, the geometry of the items (D-007).
const wgs84 = 4326;

// The columns the rows bring the distance from the center in, and the geometry in 4326, where the column keeps another
// SRID. No field of Directus is named with a colon.
const measured = 'geospatial:distance';
const converted = 'geospatial:4326';

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The rows of what a raw statement returned, which Postgres hands inside rows.
export const rowsIn = (result: unknown): Record<string, unknown>[] => {
	const rows = isRow(result) ? result.rows : undefined;

	return Array.isArray(rows) ? rows.filter(isRow) : [];
};

// The type and the SRID of a column, from its row of the catalog. A geometry declared without an SRID keeps the one
// Directus writes it in, 4326, as a geography does in PostGIS (V-25, V-178). A field the catalog does not show as
// spatial is one the schema of Directus no longer matches, and the radius fails closed.
export const columnIn = (
	row: Record<string, unknown> | undefined,
	collection: string,
	field: string,
): SpatialColumn => {
	const type = row?.type;
	const srid = row?.srid;

	if ((type !== 'geometry' && type !== 'geography') || typeof srid !== 'number') {
		throw new Error(`The field ${field} of ${collection} is not a column of PostGIS.`);
	}

	return { type, srid: srid === 0 ? wgs84 : srid };
};

// How far, in meters, a point of the edge of a box may come back from the SRID of a column to 4326. An exact projection
// brings it back to the same point; an approximate one, far from its center, misses by kilometers (V-178).
const drift = 0.001;

// A box PROJ converted, from its row, which only holds the circle where PROJ brings its edge back to where it was.
export const boxIn = ({ west, south, east, north, missed }: Record<string, unknown>): Box | null => {
	if (typeof west !== 'number' || typeof south !== 'number' || typeof east !== 'number' || typeof north !== 'number') {
		throw new Error('PostGIS did not return the converted box.');
	}

	return typeof missed === 'number' && missed <= drift ? [west, south, east, north] : null;
};

// What a read returns, or null where PROJ could not convert: past the domain of a projection, PostGIS raises it as an
// internal error of Postgres (V-178). Any other error goes on, for the radius to fail closed.
export const unlessProjFails = async <T>(read: () => Promise<T>): Promise<T | null> => {
	try {
		return await read();
	} catch (error) {
		if (isRow(error) && error.code === 'XX000') {
			return null;
		}

		throw error;
	}
};

const wktOf = (ring: Position[]) => `LINESTRING(${ring.map(([x, y]) => `${String(x)} ${String(y)}`).join(', ')})`;

// The adapter of PostGIS, the reference of the catalog (D-002).
export const postgis: MeasuringAdapter = {
	// From the catalog, by the table the permitted query reads, resolved by the same search path.
	columnOf: async (knex, collection, field) => {
		const [row] = rowsIn(
			await knex.raw(
				`select t.typname as type, postgis_typmod_srid(a.atttypmod) as srid
				from pg_attribute as a join pg_type as t on t.oid = a.atttypid
				where a.attrelid = to_regclass(quote_ident(?)) and a.attname = ? and not a.attisdropped`,
				[collection, field],
			),
		);

		return columnIn(row, collection, field);
	},

	// A geography goes without them: its ST_DWithin adds the box of its own index, in the space of the ellipsoid, where a
	// box in degrees would not hold the circle (V-178). In another SRID, PROJ converts the edge of each box, cut short so
	// a bent side is not missed, and the box of what comes back holds the circle, as long as the conversion is one to
	// one: the edge goes back to 4326 and has to land where it was. Where PROJ cannot convert a box, past the domain of a
	// projection, or does not bring it back, the radius goes without the boxes, slower and still exact.
	boxesIn: async (knex, { type, srid }, center, distance) => {
		if (type === 'geography') {
			return null;
		}

		const boxes = boxesOf(center, distance);

		if (boxes === null || srid === wgs84) {
			return boxes;
		}

		// Each box goes to the SRID of the column and back, and the row says how far its edge came back from where it was.
		const convert = async () => {
			const result: unknown = await knex.raw(
				`with converted as materialized (
					select edge, ST_Transform(edge, ?::integer) as box
					from (values ${boxes.map(() => '(ST_GeomFromText(?, 4326))').join(', ')}) as boxes (edge)
				), back as materialized (
					select edge, box, ST_Transform(box, 4326) as returned from converted
				)
				select ST_XMin(box) as west, ST_YMin(box) as south, ST_XMax(box) as east, ST_YMax(box) as north, (
					select max(ST_Distance(ST_PointN(edge, n)::geography, ST_PointN(returned, n)::geography))
					from generate_series(1, ST_NPoints(edge)) as n
				) as missed
				from back`,
				[srid, ...boxes.map((box) => wktOf(ringOf(box)))],
			);

			return rowsIn(result).map(boxIn);
		};
		const inSrid = await unlessProjFails(convert);

		return inSrid?.every((box): box is Box => box !== null) === true ? inSrid : null;
	},

	// The filter in two stages, both on the column, as more conditions of the permitted query (D-049): the box, which the
	// GiST answers, and the distance over the ellipsoid, through geography (D-007, V-42). Directus orders every permitted
	// query, which keeps Postgres from pulling it up, so a condition around it never reaches the index (V-177). The
	// conditions only discard rows, and what goes out is still decided by the value the permitted query exposes: the case
	// when of a policy leaves it null where the item goes through without the field, and those items stay out (V-142,
	// V-143). The rows keep the columns of the permitted query, the geometry still as text, which Directus turns into
	// GeoJSON as it does for /items (V-173). In another SRID, what comes in goes to the one of the column, and the stage
	// the index answers reads the column as it is. Only the distance reads a projected column in 4326, on what the box
	// left, since geography takes degrees. What goes out goes to 4326 from the text the permitted query exposes, and so
	// does the distance, which orders the list unless the page asks its own order. The order of the page reads the values
	// the permitted query exposes, where Directus orders /items by the column itself, so an item whose field a policy
	// holds back sorts as an empty one, and its place in the list tells nothing of the value (V-179).
	radius: (knex, { permitted, collection, geometry, key, column, boxes, center, distance, order, limit, offset }) => {
		const raw = `${collection}.${geometry}`;
		const [longitude, latitude] = center;
		const near = permitted.clone();

		if (boxes !== null) {
			near.andWhere((inBox) => {
				for (const box of boxes) {
					inBox.orWhereRaw('?? && ST_MakeEnvelope(?, ?, ?, ?, ?)', [raw, ...box, column.srid]);
				}
			});
		}

		if (column.type === 'geography' && column.srid === wgs84) {
			near.andWhereRaw('ST_DWithin(??, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)', [
				raw,
				longitude,
				latitude,
				distance,
			]);
		} else if (column.type === 'geography') {
			near.andWhereRaw('ST_DWithin(??, ST_Transform(ST_SetSRID(ST_MakePoint(?, ?), 4326), ?::integer)::geography, ?)', [
				raw,
				longitude,
				latitude,
				column.srid,
				distance,
			]);
		} else {
			near.andWhereRaw(
				`ST_DWithin(${column.srid === wgs84 ? '??' : 'ST_Transform(??, 4326)'}::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)`,
				[raw, longitude, latitude, distance],
			);
		}

		// The geometry the permitted query exposes, in 4326.
		const exposed =
			column.srid === wgs84
				? knex.raw('ST_GeomFromText(??, 4326)', [`p.${geometry}`])
				: knex.raw('ST_Transform(ST_GeomFromText(??, ?), 4326)', [`p.${geometry}`, column.srid]);

		const builder = knex
			.select(
				'p.*',
				knex.raw('ST_Distance(?::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) as ??', [
					exposed,
					longitude,
					latitude,
					measured,
				]),
			)
			.from(near.as('p'))
			.whereNotNull(`p.${geometry}`);

		if (column.srid !== wgs84) {
			builder.select(knex.raw('ST_AsText(?) as ??', [exposed, converted]));
		}

		if (order.length === 0) {
			builder.orderBy(measured);
		}

		for (const { field, direction } of order) {
			builder.orderBy(`p.${field}`, direction);
		}

		builder.orderBy(`p.${key}`).limit(limit);

		if (offset > 0) {
			builder.offset(offset);
		}

		return column.srid === wgs84 ? { builder, distance: measured } : { builder, distance: measured, converted };
	},
};

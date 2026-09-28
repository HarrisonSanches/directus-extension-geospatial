import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query } from '@directus/types';
import { clientOf, isRow, permittedFor, type PermittedRequest, permittedRequestOf } from './request.js';

interface TileRequest extends PermittedRequest {
	z: number;
	x: number;
	y: number;
	// How many cells a side of the tile holds.
	cells: number;
}

// MapLibre draws every vector tile at 512 px, and refuses any other size (VectorTileSource).
const tilePixels = 512;

// The width of a cell on the screen when the page asks for none, as in D-005.
const defaultCellPixels = 60;

// Web Mercator ends at the latitude where the map is square, atan(sinh(π)). The items beyond it are on no tile.
const mercatorLatitude = 85.0511287798066;

const integerOf = (value: unknown, name: string, below: number): number => {
	const number = Number(value);

	if (typeof value !== 'string' || !Number.isSafeInteger(number) || number < 0 || number >= below) {
		throw new InvalidQueryError({ reason: `${name} must be an integer from 0 to ${String(below - 1)}` });
	}

	return number;
};

// The cell goes in pixels, and the tile holds a whole number of cells, the nearest to that width, so no cell crosses
// the edge of a tile: 60 px become 9 cells of 56.9 px.
const cellsOf = (value: unknown): number => {
	const pixels = value === undefined ? defaultCellPixels : Number(value);

	if ((typeof value !== 'string' && value !== undefined) || !Number.isFinite(pixels) || pixels <= 0) {
		throw new InvalidQueryError({ reason: 'cell must be a width in pixels' });
	}

	return Math.max(1, Math.round(tilePixels / pixels));
};

export const tileRequestOf = (
	collection: string,
	params: Record<string, string>,
	query: Record<string, unknown>,
	page: Query | undefined,
	accountability: Accountability | undefined,
): TileRequest => {
	// Zoom 24 is past the street, and 2^24 tiles on a side still fit an integer.
	const z = integerOf(params.z, 'z', 25);

	return {
		...permittedRequestOf(collection, query, page, accountability),
		z,
		x: integerOf(params.x, 'x', 2 ** z),
		y: integerOf(params.y, 'y', 2 ** z),
		cells: cellsOf(query.cell),
	};
};

// The tile of the permitted query of whoever asks (D-001), as a vector tile built by the database with ST_AsMVT (D-004),
// with the items grouped by cells of the screen (D-005, F01-13).
//
// The cells follow a grid of the whole world at each zoom, the columns and rows of the XYZ tiles split into cells, so a
// cell belongs to one tile and each item to one cell, by the integer part of its position on that grid. An item on the
// edge between two tiles goes to the one on its east or on its south, and no tile repeats an item or a group of the
// tile beside it. The position comes from the longitude and the latitude by the formula of the XYZ tiles, and the grid
// reads it as the tests do.
//
// The collection is the layer of the tile. A cell with one item sends the item, with its id as the id of the feature. A
// cell with more sends a group, with the count, the mean position in Web Mercator, which stays inside the cell and so
// inside the tile, and the rectangle of the items in longitude and latitude, where a click zooms to.
export const tile = async (request: TileRequest, context: ApiExtensionContext): Promise<Buffer> => {
	const knex = context.database;

	if (clientOf(knex) !== 'Client_PG') {
		throw new Error(`The spikes have no tile for the database of ${clientOf(knex)}.`);
	}

	const { z, x, y, cells } = request;
	// The cells on a side of the world at this zoom.
	const scale = 2 ** z * cells;

	// The geometry goes by its name, as in the radius. The limit of -1 lifts QUERY_LIMIT_DEFAULT, and a tile shows every
	// item it covers, whatever the page.
	const { builder: permitted } = await permittedFor(request, context, (hooked) => ({
		...hooked,
		fields: ['id', 'geometry'],
		limit: -1,
	}));

	// The permitted query exposes the geometry as text, null where a policy lets the item through without the field, and
	// the envelope reads that text, and never the column itself (A-023).
	const result: unknown = await knex.raw(
		`with located as (
			select p.id, ST_X(p.point) as longitude, ST_Y(p.point) as latitude, ST_Transform(p.point, 3857) as mercator,
				floor((ST_X(p.point) + 180) / 360 * ?) as cell_x,
				floor((1 - asinh(tan(radians(ST_Y(p.point)))) / pi()) / 2 * ?) as cell_y
			from (select p.id, ST_GeomFromText(p.geometry, 4326) as point from ? as p where p.geometry is not null) as p
			where abs(ST_Y(p.point)) < ?
		), grouped as (
			select count(*) as count, min(id) as id,
				min(longitude) as west, min(latitude) as south, max(longitude) as east, max(latitude) as north,
				ST_SetSRID(ST_MakePoint(avg(ST_X(mercator)), avg(ST_Y(mercator))), 3857) as mercator
			from located
			where floor(cell_x / ?) = ? and floor(cell_y / ?) = ?
			group by cell_x, cell_y
		)
		select ST_AsMVT(features, ?, 4096, 'geometry', 'id') as tile from (
			select case when count = 1 then id end as id,
				case when count > 1 then count end as count,
				case when count > 1 then west end as west,
				case when count > 1 then south end as south,
				case when count > 1 then east end as east,
				case when count > 1 then north end as north,
				ST_AsMVTGeom(mercator, ST_TileEnvelope(?, ?, ?)) as geometry
			from grouped
		) as features`,
		[scale, scale, permitted, mercatorLatitude, cells, x, cells, y, request.collection, z, x, y],
	);

	const rows: unknown[] = isRow(result) && Array.isArray(result.rows) ? result.rows : [];
	const [row] = rows;

	if (!isRow(row) || !Buffer.isBuffer(row.tile)) {
		throw new Error('The database returned no tile.');
	}

	return row.tile;
};

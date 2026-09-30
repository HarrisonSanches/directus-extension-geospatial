import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createCollection, createPermission, customEndpoint, readPolicies } from '@directus/sdk';
import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { format, resolveConfig } from 'prettier';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { as, type Client, hasCustomPermissionRules, versions } from '../test/directus.ts';
import { log } from '../test/environment.ts';
import { southZone } from '../test/seed.ts';

type Position = [number, number];

// An item of the collection of the tile, as the /items returns it.
interface Item {
	id: number;
	region: string;
	geometry: { type: 'Point'; coordinates: Position } | null;
}

interface Tile {
	x: number;
	y: number;
}

// What a cell of a tile sends: the item alone, by its id, or a group with the count and the rectangle of its items.
interface Cell {
	id?: number;
	count?: number;
	west?: number;
	south?: number;
	east?: number;
	north?: number;
	// Where the feature is on the tile, in the coordinates of its extent.
	at: Position;
}

// The collection of this file, apart from the occurrences the other files of the project read, since the files run in
// parallel.
const collection = 'tile_occurrences';

// Zoom 12, with tiles of about 9 km on a side in São Paulo. A cell of 60 px becomes 9 cells on a side of the tile of
// 512 px, of about 1 km.
const z = 12;
const cellPixels = 60;
const cells = 9;
const scale = 2 ** z * cells;
const extent = 4096;

// Four tiles around a corner in the south zone, and the one the golden file keeps, east of the vertical edge between
// them and north of the horizontal one.
const around: Tile[] = [
	{ x: 1516, y: 2325 },
	{ x: 1517, y: 2325 },
	{ x: 1516, y: 2326 },
	{ x: 1517, y: 2326 },
];
const golden: Tile = { x: 1517, y: 2325 };

// The column and the row of cells where the golden tile and the ones below it start: the edges between the four tiles.
const edgeX = 1517 * cells;
const edgeY = 2326 * cells;

// About 1 cm on the ground, in cells.
const cm = 1e-5;

// The point at a position on the grid of cells of the zoom, in longitude and latitude, by the inverse of the formula of
// the XYZ tiles. A whole column is an exact longitude, and a row is not an exact latitude.
const pointAt = (column: number, row: number): Position => [
	(column / scale) * 360 - 180,
	(Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / scale))) * 180) / Math.PI,
];

// The cell of a point, with the operations of the route in the same order (spikes/extension/src/tile.ts).
const cellOf = ([longitude, latitude]: Position): Position => [
	Math.floor(((longitude + 180) / 360) * scale),
	Math.floor(((1 - Math.asinh(Math.tan(latitude * (Math.PI / 180))) / Math.PI) / 2) * scale),
];

const isIn =
	({ x, y }: Tile) =>
	({ geometry }: Pick<Item, 'geometry'>) => {
		if (geometry === null) {
			return false;
		}

		const [column, row] = cellOf(geometry.coordinates);

		return Math.floor(column / cells) === x && Math.floor(row / cells) === y;
	};

// Web Mercator on the sphere of EPSG:3857, and the position on the extent of a tile, with the y down.
const earth = 6378137;
const half = Math.PI * earth;

const mercatorOf = ([longitude, latitude]: Position): Position => [
	earth * longitude * (Math.PI / 180),
	earth * Math.asinh(Math.tan(latitude * (Math.PI / 180))),
];

const onTile = ([x, y]: Position, tile: Tile): Position => {
	const span = (2 * half) / 2 ** z;

	return [((x + half - tile.x * span) / span) * extent, ((half - tile.y * span - y) / span) * extent];
};

const at = (region: string, column: number, row: number) => ({
	region,
	geometry: { type: 'Point', coordinates: pointAt(column, row) },
});

// The items of the proof, by their position on the grid of cells: the whole part names the cell, and the fraction the
// place inside it.
const items = [
	// A group in a cell of the golden tile, with both zones: 4 items for Maria and 6 for the admin.
	at('south', 13655.2, 20928.3),
	at('south', 13655.4, 20928.5),
	at('south', 13655.6, 20928.7),
	at('south', 13655.8, 20928.4),
	at('north', 13655.5, 20928.6),
	at('north', 13655.3, 20928.9),
	// An item alone in its cell.
	at('south', 13658.5, 20930.5),
	// An item of Maria beside one of the north zone: alone for her, and a group of 2 for the admin.
	at('south', 13660.3, 20926.3),
	at('north', 13660.7, 20926.7),
	// A cell with the north zone only, which Maria never sees.
	at('north', 13657.2, 20932.2),
	at('north', 13657.5, 20932.5),
	at('north', 13657.8, 20932.8),
	// Exactly on the vertical edge between two tiles, which goes to the tile on the east.
	at('south', edgeX, 20929.2),
	at('south', edgeX, 20929.6),
	at('north', edgeX, 20929.8),
	// 1 cm west of it, in the cell beside, on the tile on the west.
	at('south', edgeX - cm, 20929.4),
	at('south', 13652.5, 20929.5),
	// 1 cm on each side of the horizontal edge.
	at('south', 13656.5, edgeY - cm),
	at('south', 13656.5, edgeY + cm),
	// Around the corner of the four tiles.
	at('south', edgeX, edgeY + cm),
	at('south', edgeX - cm, edgeY - cm),
	at('north', edgeX, edgeY - cm),
	at('south', edgeX - cm, edgeY + cm),
	// Exactly on the edge between two cells of a tile, and 1 cm west of it: two items apart.
	at('south', 13656, 20931.5),
	at('south', 13656 - cm, 20931.5),
	// On the other tiles.
	at('south', 13648.2, 20938.2),
	at('south', 13648.5, 20938.5),
	at('south', 13648.8, 20938.8),
	at('north', 13646.5, 20927.5),
	// Outside the four tiles, and without a geometry.
	at('south', 13640.5, 20930.5),
	{ region: 'south', geometry: null },
];

// The /items of the collection of the tile, which the schema of the suite does not know, by its path.
const itemsOf = (client: Client) =>
	client.request(
		customEndpoint<Item[]>({
			path: `/items/${collection}`,
			method: 'GET',
			params: { fields: ['id', 'region', 'geometry'], limit: -1 },
		}),
	);

// The tile as the route sends it, in bytes. The SDK hands over the response as it is when it is neither JSON nor text.
const bytesOf = async (client: Client, { x, y }: Tile) => {
	const response = await client.request(
		customEndpoint<Response>({
			path: `/geospatial-spikes/tile/${collection}/${String(z)}/${String(x)}/${String(y)}`,
			method: 'GET',
			params: { cell: cellPixels },
		}),
	);

	expect(response.headers.get('Content-Type')).toMatch(/^application\/vnd\.mapbox-vector-tile/);

	return new Uint8Array(await response.arrayBuffer());
};

const featuresOf = (bytes: Uint8Array): VectorTileFeature[] => {
	const layer = new VectorTile(new PbfReader(bytes)).layers[collection];

	return layer === undefined ? [] : Array.from({ length: layer.length }, (_, index) => layer.feature(index));
};

const numberOf = (value: unknown) => (typeof value === 'number' ? value : undefined);

// The items alone by their id, then the groups by the corner of their rectangle, which no two cells share.
const keyOf = ({ id, west, south }: Cell) =>
	id === undefined ? `group ${String(west)} ${String(south)}` : `item ${String(id).padStart(9, '0')}`;

const byKey = (a: Cell, b: Cell) => keyOf(a).localeCompare(keyOf(b));

// The cells of a tile as the tile sends them.
const cellsIn = (features: VectorTileFeature[]): Cell[] =>
	features
		.map((feature): Cell => {
			const [[point] = []] = feature.loadGeometry();
			const { count, west, south, east, north } = feature.properties;

			if (point === undefined) {
				throw new Error('A feature of the tile has no point.');
			}

			return {
				...(feature.id !== undefined && { id: feature.id }),
				...(count !== undefined && {
					count: numberOf(count),
					west: numberOf(west),
					south: numberOf(south),
					east: numberOf(east),
					north: numberOf(north),
				}),
				at: [point.x, point.y],
			};
		})
		.sort(byKey);

// The cells a tile should send, out of what the /items of a user returns: each item in the cell of its position, and
// a group at the mean position of its items in Web Mercator.
const expectedCells = (permitted: Item[], tile: Tile): Cell[] => {
	const located = permitted.flatMap(({ id, geometry }) => (geometry === null ? [] : [{ id, geometry }]));
	const grouped = Map.groupBy(located.filter(isIn(tile)), ({ geometry }) => cellOf(geometry.coordinates).join());

	return [...grouped.values()]
		.map((group): Cell => {
			const positions = group.map(({ geometry }) => geometry.coordinates);
			const mercator = positions.map(mercatorOf);
			const mean: Position = [
				mercator.reduce((sum, [x]) => sum + x, 0) / mercator.length,
				mercator.reduce((sum, [, y]) => sum + y, 0) / mercator.length,
			];
			const [first] = group;

			if (group.length === 1 && first !== undefined) {
				return { id: first.id, at: onTile(mean, tile) };
			}

			return {
				count: group.length,
				west: Math.min(...positions.map(([longitude]) => longitude)),
				south: Math.min(...positions.map(([, latitude]) => latitude)),
				east: Math.max(...positions.map(([longitude]) => longitude)),
				north: Math.max(...positions.map(([, latitude]) => latitude)),
				at: onTile(mean, tile),
			};
		})
		.sort(byKey);
};

// The tile sends the cells expected, with each position rounded to the integer grid of its extent, so half a unit
// apart at most.
const expectCells = (sent: Cell[], expected: Cell[]) => {
	const withoutPlace = ({ id, count, west, south, east, north }: Cell) => ({ id, count, west, south, east, north });

	expect(sent.map(withoutPlace)).toEqual(expected.map(withoutPlace));

	for (const [
		index,
		{
			at: [x, y],
		},
	] of sent.entries()) {
		const [expectedX = Number.NaN, expectedY = Number.NaN] = expected[index]?.at ?? [];

		expect(Math.abs(x - expectedX)).toBeLessThanOrEqual(0.5 + 1e-6);
		expect(Math.abs(y - expectedY)).toBeLessThanOrEqual(0.5 + 1e-6);
	}
};

// How many items the cells of a tile hold: the count of each group, and one for each item alone.
const total = (sent: Cell[]) => sent.reduce((sum, { count }) => sum + (count ?? 1), 0);

// The error a request fails with, to compare the one of the tile with the one of the /items.
const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error instanceof Object && 'errors' in error ? error.errors : error;
	}

	throw new Error('The request did not fail.');
};

// The golden file keeps the tile decoded to GeoJSON, as Prettier writes it, so pnpm format:check accepts it.
const goldenFile = fileURLToPath(new URL('testdata/tile-maria.geojson', import.meta.url));

const goldenOf = async (bytes: Uint8Array, { x, y }: Tile) => {
	const features = featuresOf(bytes)
		.map((feature) => feature.toGeoJSON(x, y, z))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	const options = await resolveConfig(goldenFile, { editorconfig: true });

	return format(JSON.stringify({ type: 'FeatureCollection', features }), { ...options, filepath: goldenFile });
};

describe.runIf(versions().database.client === 'postgres')('um tile MVT em volta da query permitida (F01-13)', () => {
	beforeAll(async () => {
		const admin = as('admin');

		await admin.request(
			createCollection({
				collection,
				schema: {},
				meta: {},
				fields: [
					{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
					{ field: 'geometry', type: 'geometry.Point', schema: {}, meta: {} },
					{ field: 'region', type: 'string', schema: {} },
				],
			}),
		);
		await admin.request(customEndpoint({ path: `/items/${collection}`, method: 'POST', body: JSON.stringify(items) }));

		if (hasCustomPermissionRules()) {
			const [policy] = await admin.request(readPolicies({ fields: ['id'], filter: { name: { _eq: 'South zone' } } }));

			if (policy === undefined) {
				throw new Error('The seed did not create the policy of Maria.');
			}

			await admin.request(
				createPermission({ policy: policy.id, collection, action: 'read', fields: ['*'], permissions: southZone }),
			);
		}
	});

	it.runIf(hasCustomPermissionRules())(
		'o tile da Maria soma nos grupos e nos itens soltos o total do /items dela dentro do tile',
		async () => {
			const permitted = await itemsOf(as('maria'));
			const startedAt = performance.now();
			const bytes = await bytesOf(as('maria'), golden);
			const milliseconds = performance.now() - startedAt;
			const sent = cellsIn(featuresOf(bytes));

			expectCells(sent, expectedCells(permitted, golden));
			expect(total(sent)).toBe(permitted.filter(isIn(golden)).length);
			// The tile holds groups and items alone.
			expect(sent.some(({ count }) => count !== undefined)).toBe(true);
			expect(sent.some(({ id }) => id !== undefined)).toBe(true);
			log(
				`${inject('combination')}: the tile ${String(z)}/${String(golden.x)}/${String(golden.y)} of Maria took ${milliseconds.toFixed(1)} ms and ${String(bytes.length)} bytes, on ${versions().spatial.name} ${versions().spatial.version}`,
			);
		},
	);

	it.runIf(hasCustomPermissionRules())(
		'nos tiles vizinhos, nenhum grupo se repete na borda, e cada item conta uma vez só',
		async () => {
			const permitted = await itemsOf(as('maria'));
			const sent = await Promise.all(
				around.map(async (tile) => ({ tile, cells: cellsIn(featuresOf(await bytesOf(as('maria'), tile))) })),
			);

			for (const { tile, cells: inTile } of sent) {
				expectCells(inTile, expectedCells(permitted, tile));
			}

			const keys = sent.flatMap(({ cells: inTile }) => inTile.map(keyOf));
			const inside = permitted.filter((item) => around.some((tile) => isIn(tile)(item)));

			expect(new Set(keys).size).toBe(keys.length);
			expect(sent.reduce((sum, { cells: inTile }) => sum + total(inTile), 0)).toBe(inside.length);
			// Every item of Maria but the one outside the four tiles and the one without a geometry.
			expect(inside.length).toBe(permitted.length - 2);
		},
	);

	it('o admin vê no mesmo tile os itens das outras zonas, e nenhum grupo da Maria tem item de outra zona', async () => {
		const everyone = await itemsOf(as('admin'));
		const sent = cellsIn(featuresOf(await bytesOf(as('admin'), golden)));

		expectCells(sent, expectedCells(everyone, golden));
		expect(everyone.filter(isIn(golden)).some(({ region }) => region === 'north')).toBe(true);

		if (!hasCustomPermissionRules()) {
			return;
		}

		const permitted = await itemsOf(as('maria'));
		const ofMaria = cellsIn(featuresOf(await bytesOf(as('maria'), golden)));

		// Maria reads the south zone only, and her tile has the groups of those items alone, fewer than the admin sees.
		expect(permitted.every(({ region }) => region === 'south')).toBe(true);
		expectCells(ofMaria, expectedCells(permitted, golden));
		expect(total(sent)).toBeGreaterThan(total(ofMaria));
	});

	it('o público recebe do tile o mesmo erro do /items', async () => {
		const items = await errorOf(itemsOf(as('public')));

		expect(await errorOf(bytesOf(as('public'), golden))).toEqual(items);
		expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
	});

	it.runIf(hasCustomPermissionRules())(
		'o tile da Maria, decodificado, é o do arquivo dourado, no 11.17 e no 12',
		async () => {
			await expect(await goldenOf(await bytesOf(as('maria'), golden), golden)).toMatchFileSnapshot(goldenFile);
		},
	);
});

import { createItems, customEndpoint, readItems } from '@directus/sdk';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { type Client, connect, type Occurrence } from '../../test/directus.ts';
import { log } from '../../test/environment.ts';
import type { DialectName } from './dialects.ts';

// What the envelope route of the spike answers (spikes/extension/src/envelope.ts).
interface Envelope {
	count: number;
	countAs: string;
	ids: number[];
	executed: string[];
	permitted: { sql: string; bindings: unknown[] };
	adapter: string;
}

// What a page sends along with the envelope, as it sends to the /items.
interface Page {
	filter?: Record<string, unknown>;
	search?: string;
	sort?: string[];
	limit?: number;
}

type Position = [number, number];

const dialect = inject('dialect');
const { url, tokens, probes } = inject('onDialect');

const as = (role: keyof typeof tokens | 'public'): Client => connect(url, role === 'public' ? null : tokens[role]);

// A convex quadrilateral in the south of São Paulo, with no side along a meridian or a parallel, in longitude and
// latitude.
const corners: Position[] = [
	[-46.75, -23.7],
	[-46.62, -23.72],
	[-46.6, -23.6],
	[-46.72, -23.58],
];

const polygon = `POLYGON((${[...corners, corners[0]]
	.filter((corner) => corner !== undefined)
	.map(([longitude, latitude]) => `${String(longitude)} ${String(latitude)}`)
	.join(', ')}))`;

const sides = corners.map((corner, index): [Position, Position] => [
	corner,
	corners[(index + 1) % corners.length] ?? corner,
]);

const cross = ([ax, ay]: Position, [bx, by]: Position, [px, py]: Position) =>
	(bx - ax) * (py - ay) - (by - ay) * (px - ax);

// On the plane of the coordinates, as ST_Intersects over a geometry of SRID 4326: a point touches a convex polygon when
// it is on the same side of every side, or on one of them.
const touches = ({ coordinates }: Occurrence['geometry']) => {
	const signs = sides.map(([a, b]) => Math.sign(cross(a, b, coordinates)));

	return signs.every((sign) => sign >= 0) || signs.every((sign) => sign <= 0);
};

const center: Position = [
	corners.reduce((sum, [longitude]) => sum + longitude, 0) / corners.length,
	corners.reduce((sum, [, latitude]) => sum + latitude, 0) / corners.length,
];

// About 1.1 cm at this latitude, which a coordinate cut short in the text of the permitted query would put on the wrong
// side of the edge.
const offset = 1e-7;

// Points at a quarter, half and three quarters of each side, one just inside and one just outside it. Half of the
// places are in the south zone and half in the north, which Maria does not read, and the status and the category vary,
// for the filter and the search.
const aroundTheSides: Omit<Occurrence, 'id'>[] = sides.flatMap(([[ax, ay], [bx, by]], side) =>
	[0.25, 0.5, 0.75].flatMap((along, step) => {
		const place = side * 3 + step;
		const [x, y] = [ax + (bx - ax) * along, ay + (by - ay) * along];
		const length = Math.hypot(bx - ax, by - ay);
		// The unit normal of the side that points to the center.
		const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
		const inward = Math.sign(nx * (center[0] - x) + ny * (center[1] - y));

		return [inward, -inward].map((direction) => ({
			region: place % 2 === 0 ? 'south' : 'north',
			category: Math.floor(place / 4) % 2 === 0 ? 'theft' : 'fire',
			status: Math.floor(place / 2) % 2 === 0 ? 'open' : 'closed',
			occurred_at: '2026-09-10T10:00:00Z',
			geometry: {
				type: 'Point' as const,
				coordinates: [x + nx * offset * direction, y + ny * offset * direction] as Position,
			},
		}));
	}),
);

const envelopeOf = (client: Client, page: Page = {}) =>
	client.request(
		customEndpoint<Envelope>({
			path: '/geospatial-spikes/envelope/occurrences',
			method: 'GET',
			params: { polygon, ...page },
		}),
	);

// What the /items of a user returns that touches the polygon, with the same page, by the calculation of the test: the
// spatial filters of Directus do not apply to a field of type geometry.Point (V-123).
const expectedFor = async (client: Client, page: Page = {}) => {
	const items = await client.request(
		customEndpoint<{ id: number; geometry: Occurrence['geometry'] | null }[]>({
			path: '/items/occurrences',
			method: 'GET',
			params: { fields: ['id', 'geometry'], limit: -1, ...page },
		}),
	);

	return items
		.filter(({ geometry }) => geometry !== null && touches(geometry))
		.map(({ id }) => id)
		.sort((a, b) => a - b);
};

// The error a request fails with, to compare the one of the envelope with the one of the /items.
const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error instanceof Object && 'errors' in error ? error.errors : error;
	}

	throw new Error('The request did not fail.');
};

const probeOf = (name: string) => probes[name] ?? { statement: '', exitCode: -1, output: '' };

// What each database answered to its probes, which its verification records. A new dialect brings its own.
const findings: Record<DialectName, () => void> = {
	// CockroachDB 25.4, on 28/09/2026 (V-148): ST_AsMVTGeom without ST_AsMVT, and the nearest items by the index only
	// within a distance (P-06).
	cockroachdb: () => {
		// The text of the permitted query keeps 15 decimals, where SpatiaLite keeps 6 (A-026).
		expect(probeOf('asText').output).toMatch(/POINT \(-\d+\.\d{15} -\d+\.\d{15}\)/);
		expect(probeOf('tileEnvelope').exitCode).toBe(0);
		expect(probeOf('tileSignatures').output).toContain('st_asmvtgeom\tgeometry, box2d');
		expect(probeOf('tileSignatures').output).not.toMatch(/^st_asmvt\t/m);
		expect(probeOf('asMvtGeom').exitCode).toBe(0);
		expect(probeOf('asMvt').exitCode).toBe(1);
		expect(probeOf('asMvt').output).toContain('unknown function: st_asmvt()');
		expect(probeOf('nearest').exitCode).toBe(1);
		expect(probeOf('nearest').output).toContain('unsupported binary operator: <geometry> <-> <geometry>');

		// A GiST index becomes an inverted index, which a predicate on the column itself uses, and never the text of the
		// permitted query.
		for (const plan of ['nearestWithinPlan', 'intersectsPlan']) {
			expect(probeOf(plan).output).toContain('inverted filter');
			expect(probeOf(plan).output).toContain('occurrences@occurrences_geometry_index');
		}

		expect(probeOf('nearestWithinPlan').output).toContain('top-k');
	},
};

describe(`o envelope sobre a query permitida, no ${dialect} (F01-08)`, () => {
	beforeAll(async () => {
		await as('admin').request(createItems('occurrences', aroundTheSides));
	});

	it('a contagem e os ids do envelope da Maria batem com o gabarito, sem os da zona norte', async () => {
		const expected = await expectedFor(as('maria'));
		const everyone = await expectedFor(as('admin'));
		const { count, ids } = await envelopeOf(as('maria'));

		expect(ids).toEqual(expected);
		expect(count).toBe(expected.length);
		// The polygon holds items Maria cannot read, and the points just outside its sides stay out.
		expect(everyone.length).toBeGreaterThan(expected.length);
		expect(expected.length).toBeGreaterThan(0);
		expect(everyone.length).toBeLessThan(aroundTheSides.length);
	});

	it('a query permitida não roda sozinha: só os dois envelopes leem as ocorrências', async () => {
		const { executed, countAs } = await envelopeOf(as('maria'));

		expect(executed).toHaveLength(2);
		expect(executed.every((sql) => sql.includes('ST_Intersects'))).toBe(true);
		expect(executed[0]).toMatch(/^select count\(\*\)/);

		for (const sql of executed) {
			log(`${dialect}: the envelope of Maria reached the database as ${sql}`);
		}

		log(`${dialect}: the driver handed the count over as a ${countAs}`);
	});

	it('o envelope do admin conta todas as ocorrências no polígono, sem filtro de permissão', async () => {
		const expected = await expectedFor(as('admin'));
		const { count, ids } = await envelopeOf(as('admin'));

		expect(ids).toEqual(expected);
		expect(count).toBe(expected.length);
	});

	it('o público recebe do envelope o mesmo erro do /items', async () => {
		const items = await errorOf(as('public').request(readItems('occurrences')));

		expect(await errorOf(envelopeOf(as('public')))).toEqual(items);
		expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
	});

	it('com o filtro e a busca da página, o envelope da Maria bate com o /items dela com os mesmos', async () => {
		const page = { filter: { status: { _eq: 'open' } }, search: 'theft' };
		const expected = await expectedFor(as('maria'), page);
		const { count, ids } = await envelopeOf(as('maria'), page);

		expect(ids).toEqual(expected);
		expect(count).toBe(expected.length);
		// The filter and the search leave out items the polygon alone would bring.
		expect(expected.length).toBeGreaterThan(0);
		expect(expected.length).toBeLessThan((await expectedFor(as('maria'))).length);
	});

	it('com o sort e o limit da página, o ORDER BY e o LIMIT ficam na subconsulta, e o envelope só conta a página', async () => {
		const page = { sort: ['-id'], limit: 5 };
		const expected = await expectedFor(as('maria'), page);
		const { count, ids, permitted, executed } = await envelopeOf(as('maria'), page);

		expect(ids).toEqual(expected);
		expect(count).toBe(expected.length);
		// The page leaves out items of Maria in the polygon that come before the last five.
		expect(expected.length).toBeGreaterThan(0);
		expect(expected.length).toBeLessThan((await expectedFor(as('maria'))).length);
		expect(permitted.sql).toMatch(/order by "occurrences"\."id" desc limit \?\)?$/);
		log(
			`${dialect}: with the sort and the limit of the page, the envelope reached the database as ${executed[1] ?? ''}`,
		);
	});

	it('as sondas das lacunas do catálogo respondem (P-06)', () => {
		for (const [name, { statement, exitCode, output }] of Object.entries(probes)) {
			log(`${dialect}: the probe ${name} (${statement}) exited with ${String(exitCode)}: ${output}`);
		}

		expect(Object.keys(probes).length).toBeGreaterThan(0);
	});

	it('o que o banco respondeu às sondas é o que a verificação dele registra', () => {
		findings[dialect]();
	});
});

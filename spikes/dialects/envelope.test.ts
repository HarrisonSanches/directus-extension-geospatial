import { createItem, createItems, customEndpoint, readField, readItem, readItems, updateItem } from '@directus/sdk';
import geographiclib from 'geographiclib-geodesic';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { type Client, connect, type Occurrence } from '../../test/directus.ts';
import { log } from '../../test/environment.ts';
import { type DialectName, runSql } from './dialects.ts';

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
const { url, tokens, probes, database } = inject('onDialect');

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

// The first row of what a probe printed, below the header, which may repeat the expression of the statement.
const valueOf = (name: string) => probeOf(name).output.split('\n')[1];

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
	// MySQL 9.7, on 28/09/2026 (V-151): the column and its values without an SRID, the axes of SRID 4326 latitude first,
	// and no spatial index on the column as Directus creates it (P-04).
	mysql: () => {
		// The shortest text that reads back as the same double: nothing of the coordinate is lost, unlike SQLite (A-026).
		expect(valueOf('asText')).toBe('POINT(-46.71234567890124 -23.612345678901235)');
		expect(probeOf('column').output).toContain('point\tYES');
		expect(probeOf('columnSrs').output).toContain('none');
		expect(probeOf('storedSrid').output).toMatch(/^0$/m);
		expect(probeOf('axisOrder').output).toMatch(/^-46\.7\t-23\.65$/m);
		expect(probeOf('mixedSrids').exitCode).toBe(1);
		expect(probeOf('mixedSrids').output).toContain('given two geometries of different srids: 0 and 4326');
		expect(probeOf('planeIntersects').exitCode).toBe(0);
		expect(probeOf('spatialIndex').exitCode).toBe(1);
		expect(probeOf('spatialIndex').output).toContain('All parts of a SPATIAL index must be NOT NULL');
	},
	// MariaDB 12.3, on 28/09/2026 (V-152): no order of the axes and no check of the SRID, the distance in meters only on
	// the sphere, and only between points (P-07).
	mariadb: () => {
		// The same text as MySQL writes, which reads back as the same double.
		expect(valueOf('asText')).toBe('POINT(-46.71234567890124 -23.612345678901235)');
		expect(probeOf('column').output).toContain('point\tYES');
		expect(valueOf('columnSrid')).toBe('0');
		expect(valueOf('storedSrid')).toBe('0');
		expect(valueOf('axisOrder')).toBe('-46.7');
		expect(probeOf('axisOrderOption').exitCode).toBe(1);
		expect(probeOf('mixedSrids').exitCode).toBe(0);
		expect(Number(valueOf('planeDistance'))).toBeCloseTo(Math.hypot(0.1, 0.05), 12);
		// A multipoint gives no error and no distance.
		expect(probeOf('sphereMultipoint').exitCode).toBe(0);
		expect(valueOf('sphereMultipoint')).toBe('NULL');
		expect(probeOf('sphereLine').exitCode).toBe(1);
		expect(probeOf('spherePolygon').exitCode).toBe(1);
		expect(probeOf('spatialIndex').exitCode).toBe(1);

		// The sphere against the ellipsoid of GeographicLib, between the two points of the probe.
		const { s12 } = geographiclib.Geodesic.WGS84.Inverse(-23.65, -46.7, -23.6, -46.6);
		const sphere = Number(valueOf('spherePoints'));

		log(`${dialect}: ST_Distance_Sphere gave ${String(sphere)} m, and GeographicLib ${String(s12)} m`);
		expect(Math.abs(sphere - (s12 ?? 0)) / (s12 ?? 1)).toBeLessThan(0.01);
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
		// Postgres and CockroachDB quote the names with double quotes, and MySQL with backticks.
		expect(permitted.sql).toMatch(/order by (["`])occurrences\1\.\1id\1 desc limit \?\)?$/);
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

// The column that takes a spatial index the optimizer considers, where Directus writes the geometry without one: MySQL
// also asks for the SRID attribute, and MariaDB for NOT NULL alone (P-04). MySQL 9 prints the plan as a tree, without
// the possible keys, unless the statement asks for the traditional format.
const indexable: Partial<Record<DialectName, { column: string; explain: string }>> = {
	mysql: { column: 'point not null srid 0', explain: 'explain format=traditional' },
	mariadb: { column: 'point not null', explain: 'explain' },
};

const indexing = indexable[dialect];

// It changes the table, so it runs after the envelope on the column as Directus creates it, in the same file, whose
// tests run one after the other.
describe.runIf(indexing !== undefined)(
	`a coluna com índice espacial sob as gravações do Directus, no ${dialect} (P-04)`,
	() => {
		const { column, explain } = indexing ?? { column: '', explain: '' };
		const sql = (statement: string) => runSql(dialect, database, statement);
		const index = 'occurrences_geometry_index';
		const where = `where st_intersects(geometry, st_geomfromtext('${polygon}'))`;

		// With a few rows, the optimizer takes the table scan by cost, so the forced index says whether it can take the index
		// at all.
		const plansOf = async () => ({
			chosen: await sql(`${explain} select id from occurrences ${where}`),
			forced: await sql(`${explain} select id from occurrences force index (${index}) ${where}`),
		});

		// A column of the tab-separated rows the client prints, by the name in its header.
		const columnOf = (output: string, name: string) => {
			const [header = '', row = ''] = output.split('\n');

			return row.split('\t')[header.split('\t').indexOf(name)];
		};

		it.runIf(dialect === 'mysql')(
			'sem o atributo SRID, o índice espacial nasce com um aviso, e o otimizador não o considera',
			async () => {
				expect((await sql('alter table occurrences modify geometry point not null')).exitCode).toBe(0);

				const created = await sql(`create spatial index ${index} on occurrences (geometry)`);
				const { chosen, forced } = await plansOf();

				expect((await sql(`drop index ${index} on occurrences`)).exitCode).toBe(0);
				log(`${dialect}: the spatial index without an SRID answered ${created.output}`);
				log(`${dialect}: without an SRID, the plan is ${chosen.output}, and with the index forced ${forced.output}`);
				expect(created.exitCode).toBe(0);
				expect(created.output).toContain('will not be used by the query optimizer');
				expect(columnOf(chosen.output, 'possible_keys')).toBe('NULL');
				expect(columnOf(forced.output, 'key')).toBe('NULL');
			},
		);

		it.runIf(dialect === 'mysql')(
			'com o SRID 4326, a coluna recusa os valores que o Directus gravou, de SRID 0',
			async () => {
				const altered = await sql('alter table occurrences modify geometry point not null srid 4326');

				log(`${dialect}: the column with SRID 4326 answered ${altered.output}`);
				expect(altered.exitCode).toBe(1);
				expect(altered.output).toContain('SRID');
			},
		);

		it(`com a coluna ${column}, o índice espacial nasce sem aviso, e o otimizador o considera`, async () => {
			expect((await sql(`alter table occurrences modify geometry ${column}`)).exitCode).toBe(0);

			const created = await sql(`create spatial index ${index} on occurrences (geometry)`);
			const { chosen, forced } = await plansOf();

			log(
				`${dialect}: with the column ${column}, the plan is ${chosen.output}, and with the index forced ${forced.output}`,
			);
			expect(created).toEqual({ exitCode: 0, output: '' });
			expect(columnOf(chosen.output, 'possible_keys')).toBe(index);
			expect(columnOf(forced.output, 'key')).toBe(index);
			expect(columnOf(forced.output, 'type')).toBe('range');
		});

		it('o Directus segue gravando e lendo a geometria, e recusa o item sem ela', async () => {
			const admin = as('admin');

			// The schema of Directus lives in its system cache, which does not see a change made outside it.
			await admin.request(customEndpoint({ path: '/utils/cache/clear', method: 'POST', params: { system: true } }));

			const geometry: Occurrence['geometry'] = { type: 'Point', coordinates: [-46.68, -23.64] };
			const moved: Occurrence['geometry'] = { type: 'Point', coordinates: [-46.69, -23.63] };
			const item = { region: 'south', category: 'theft', status: 'open', occurred_at: '2026-09-11T10:00:00Z' };
			const { id } = await admin.request(createItem('occurrences', { ...item, geometry }));

			expect((await admin.request(readItem('occurrences', id))).geometry).toEqual(geometry);

			await admin.request(updateItem('occurrences', id, { geometry: moved }));
			expect((await admin.request(readItem('occurrences', id))).geometry).toEqual(moved);

			const refused = await errorOf(admin.request(createItem('occurrences', item)));
			const field = await admin.request(readField('occurrences', 'geometry'));

			log(`${dialect}: an item without a geometry got ${JSON.stringify(refused)}`);
			log(`${dialect}: Directus reads the field as ${JSON.stringify({ type: field.type, schema: field.schema })}`);
			expect(refused).toBeDefined();
			expect(field).toMatchObject({ type: 'geometry.Point', schema: { is_nullable: false } });
		});

		it('o envelope da Maria continua batendo com o gabarito sobre a coluna nova', async () => {
			const expected = await expectedFor(as('maria'));
			const { count, ids } = await envelopeOf(as('maria'));

			expect(ids).toEqual(expected);
			expect(count).toBe(expected.length);
		});
	},
);

import type { Accountability, Query, SchemaOverview } from '@directus/types';
import type { Internals, Radius } from 'directus-geospatial-contract';
import geographiclib from 'geographiclib-geodesic';
import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import type { MeasuringAdapter, RadiusEnvelope, SelectingAdapter } from '../../db/adapter.js';
import type { Request } from '../../internals/chain.js';
import { database } from '../../internals/fake-directus.js';
import { limits } from '../../limits.js';
import { afterOf, cursorOf, type List } from '../../query/cursor.js';
import { keyOf } from '../../query/key.js';
import { type Engine, itemsOf, radiusItems, type RadiusRequest, unaskedOf } from './items.js';
import { radiusLevels } from './levels.js';

const maria: Accountability = {
	role: 'operator',
	roles: ['operator'],
	user: 'maria',
	admin: false,
	app: true,
	ip: null,
};

const schema = {
	collections: {
		occurrences: {
			collection: 'occurrences',
			primary: 'id',
			fields: {
				id: { field: 'id', type: 'integer' },
				geometry: { field: 'geometry', type: 'geometry.Point' },
				region: { field: 'region', type: 'string' },
			},
		},
		// A collection of the system with a geometry field someone added, which /items refuses all the same.
		directus_users: {
			collection: 'directus_users',
			primary: 'id',
			fields: { id: { field: 'id', type: 'uuid' }, location: { field: 'location', type: 'geometry.Point' } },
		},
	},
	relations: [],
} as unknown as SchemaOverview;

const geo: Radius = { operation: 'radius', center: [-46.7, -23.65], distance: 1000 };

const cursorKey = keyOf('a secret of Directus', 'cursor');

// The list of the requests of the tests, in the natural order, which their cursors belong to.
const natural: List = { collection: 'occurrences', geo, sort: [] };

// The engine of the radius over the fake Directus: the chain hands back a query of the Knex that never connects, so
// nothing runs, and a query that tried to fails as a database that went down.
const engineWith = (overrides: Partial<Engine> = {}) => {
	const built: Request[] = [];
	const logged: unknown[] = [];
	const engine: Engine = {
		knex: database,
		schema,
		client: 'postgres',
		internals: () => Promise.resolve({ status: 'accepted', adapter: '12' }),
		// With no hook of items.query, the chain gets what the radius asks of the page as it came, and the * of the tree
		// holds every field of the collection, as the admin reads it.
		permittedQuery: (request, _, queryOf = (hooked) => hooked) => {
			const query = queryOf(request.query);

			built.push({ ...request, query });

			return Promise.resolve({
				builder: database.select('id', 'geometry').from('occurrences'),
				query: request.query,
				fields: (query.fields ?? []).flatMap((field) =>
					field === '*' ? ['id', 'geometry', 'region', 'status'] : [field],
				),
			});
		},
		logger: { error: (error: unknown) => logged.push(error) },
		valuesOf: (_, rows) => Promise.resolve(rows),
		defaultLimit: 100,
		levels: radiusLevels,
		cursorKey,
		...overrides,
	};

	return { engine, built, logged };
};

const radiusWith = (request: Partial<RadiusRequest>, engine: Engine) =>
	radiusItems(
		{ collection: 'occurrences', geo, page: { fields: ['*'], limit: 100 }, accountability: maria, ...request },
		engine,
	);

const refused: Internals = { status: 'refused', problems: { '12': ['missing'] } };

describe('o raio, antes do banco', () => {
	it.each([
		['um parâmetro que o raio ainda não trata', { page: { fields: ['*'], group: ['region'] } }, {}, 'INVALID_QUERY'],
		['o limit acima do máximo do contrato', { page: { fields: ['*'], limit: 1001 } }, {}, 'INVALID_QUERY'],
		['os internos recusados', {}, { internals: () => Promise.resolve(refused) }, 'GEOSPATIAL_INTERNALS_UNSUPPORTED'],
		['um banco onde o raio não roda', {}, { client: 'mysql' as const }, 'GEOSPATIAL_OPERATION_UNAVAILABLE'],
		['uma coleção que o esquema não tem', { collection: 'nowhere' }, {}, 'FORBIDDEN'],
		['uma coleção do sistema, mesmo com uma geometria', { collection: 'directus_users' }, {}, 'FORBIDDEN'],
	])('%s volta com o erro, sem montar a query permitida', async (_, request, overrides, code) => {
		const { engine, built } = engineWith(overrides);

		await expect(radiusWith(request, engine)).rejects.toMatchObject({ code });
		expect(built).toEqual([]);
	});

	it('onde o raio não roda, o erro diz a operação e o motivo', async () => {
		const { engine } = engineWith({ client: 'mysql' });

		await expect(radiusWith({}, engine)).rejects.toMatchObject({
			status: 501,
			extensions: { operation: 'radius', reason: 'It does not run on the database in use yet.' },
		});
	});

	it('um campo que não é de geometria passa primeiro pela cadeia, que recusa quem não lê a coleção', async () => {
		const { engine, built } = engineWith();

		await expect(radiusWith({ geo: { ...geo, field: 'region' } }, engine)).rejects.toMatchObject({
			code: 'GEOSPATIAL_INVALID_INPUT',
			extensions: { reason: 'The field region of occurrences is not a geometry' },
		});
		expect(built.map(({ query }) => query.fields)).toEqual([['*']]);
	});
});

describe('a página que os hooks de items.query devolvem (V-144)', () => {
	it('também passa pelo que o raio aceita: um hook que pede a ordem por uma relação tem o pedido recusado, e não ignorado', async () => {
		const { engine } = engineWith({
			permittedQuery: (request, _, queryOf = (hooked) => hooked) => {
				const hooked = { ...request.query, sort: ['author.name'] };

				return Promise.resolve({
					builder: database.select('id').from('occurrences'),
					query: queryOf(hooked),
					fields: [],
				});
			},
		});

		await expect(radiusWith({}, engine)).rejects.toMatchObject({
			code: 'INVALID_QUERY',
			extensions: { reason: 'The radius does not take sort by a relation yet' },
		});
	});
});

describe('a query permitida do raio', () => {
	it.each([
		['a página toda', { fields: ['id'], limit: 10, offset: 5 }, ['id', 'geometry']],
		['a página pelo número', { fields: ['id', 'region'], limit: 10, page: 3 }, ['id', 'region', 'geometry']],
		['sem os campos', { limit: 1000 }, ['*', 'geometry']],
	])('%s: sai sem limite, sem deslocamento e sem página, com a geometria pelo nome', async (_, page: Query, fields) => {
		const { engine, built } = engineWith();

		await radiusWith({ page }, engine).catch(() => undefined);

		expect(built).toEqual([{ collection: 'occurrences', query: { fields, limit: -1 }, accountability: maria }]);
	});

	it('com o sort, a ordem vai à cadeia, que confere a permissão dos campos, e eles são lidos pelo nome', async () => {
		const { engine, built } = engineWith();

		await radiusWith({ page: { fields: ['id'], sort: ['-status'] } }, engine).catch(() => undefined);

		expect(built.map(({ query }) => query)).toEqual([
			{ fields: ['id', 'geometry', 'status'], sort: ['-status'], limit: -1 },
		]);
	});

	it('com o banco fora, o raio falha fechado, com a causa só no log', async () => {
		const { engine, logged } = engineWith();

		await expect(radiusWith({}, engine)).rejects.toMatchObject({
			code: 'GEOSPATIAL_DATABASE_UNAVAILABLE',
			status: 503,
		});
		expect(logged).toHaveLength(1);
	});
});

describe('os itens que o raio devolve', () => {
	it.each([
		['com fields=*, nenhum campo sai', { fields: ['*'], sort: ['status'] }, []],
		['sem os campos, como o * do /items', { sort: ['status'] }, []],
		['sem a geometria nos campos, ela sai', { fields: ['id'] }, ['geometry']],
		['o campo lido só para ordenar sai', { fields: ['id', 'geometry'], sort: ['-status'] }, ['status']],
		['o campo pedido e usado na ordem fica', { fields: ['id', 'status'], sort: ['-status'] }, ['geometry']],
	])('%s', (_, query: Query, unasked) => {
		expect(unaskedOf(query, 'geometry')).toEqual(unasked);
	});

	it('cada item leva a distância no $geo, só com os campos que ficam', () => {
		const values = [
			{ id: 1, status: 'open', geometry: { type: 'Point', coordinates: [-46.7, -23.65] } },
			{ id: 2, status: 'closed', geometry: { type: 'Point', coordinates: [-46.7, -23.6] } },
		];

		expect(itemsOf(values, [0, 5_558.6], ['id'])).toEqual([
			{ id: 1, $geo: { distance: 0 } },
			{ id: 2, $geo: { distance: 5_558.6 } },
		]);
	});
});

// What a statement of a fake adapter returns when awaited, in place of the builder of Knex, which would run it.
const returning = (result: unknown) => Promise.resolve(result) as unknown as Knex.QueryBuilder;

const center = geo.center;

// The point at a distance north of the center, in the WKT the permitted query exposes.
const northOf = (meters: number) => {
	const { lon2, lat2 } = geographiclib.Geodesic.WGS84.Direct(center[1], center[0], 0, meters);

	return `POINT(${String(lon2)} ${String(lat2)})`;
};

// An adapter of a database that only tells which items are inside the circle, which hands back the rows given, and keeps
// the envelopes it got.
const selecting = (result: unknown, measures = true, keys: string[] = []) => {
	const envelopes: RadiusEnvelope[] = [];
	const adapter: SelectingAdapter = {
		columnOf: () => Promise.resolve({ type: 'geometry', srid: 4326 }),
		boxesIn: () => Promise.resolve(null),
		measures: () => Promise.resolve(measures),
		radius: (_, envelope) => {
			envelopes.push(envelope);

			return { builder: returning(result), keys };
		},
	};

	return { adapter, envelopes };
};

const onSqlite = (adapter: SelectingAdapter) =>
	engineWith({ client: 'sqlite', levels: { ...radiusLevels, sqlite: { level: 'capped', adapter } } });

describe('o raio onde o servidor mede (D-052)', () => {
	it('na ordem natural, o banco entrega pela chave, e o servidor ordena pela distância, com a janela da página', async () => {
		const { adapter, envelopes } = selecting([
			{ id: 1, geometry: northOf(300) },
			{ id: 2, geometry: northOf(100) },
			{ id: 3, geometry: northOf(200) },
		]);
		const { engine } = onSqlite(adapter);
		const response = await radiusWith({ page: { fields: ['id'], limit: 2, offset: 1 } }, engine);

		expect(envelopes.map(({ order, limit, offset }) => ({ order, limit, offset }))).toEqual([
			{ order: [], limit: limits.server + 1, offset: 0 },
		]);
		expect(response.data.map(({ id }) => id)).toEqual([3, 1]);
		expect(response.data[0]?.$geo.distance).toBeCloseTo(200, 6);
		expect(response).not.toHaveProperty('meta');
	});

	it('a página pelo número abre a janela depois das anteriores', async () => {
		const { adapter } = selecting(
			[100, 200, 300, 400].map((meters, index) => ({ id: index + 1, geometry: northOf(meters) })),
		);
		const { engine } = onSqlite(adapter);

		expect(
			(await radiusWith({ page: { fields: ['id'], limit: 2, page: 2 } }, engine)).data.map(({ id }) => id),
		).toEqual([3, 4]);
	});

	it('acima do limite do servidor, o resultado avisa no meta', async () => {
		const rows = Array.from({ length: limits.server + 1 }, (_, index) => ({ id: index + 1, geometry: northOf(10) }));
		const { engine } = onSqlite(selecting(rows).adapter);

		expect((await radiusWith({ page: { fields: ['id'], limit: 1 } }, engine)).meta).toMatchObject({
			capped: { limit: limits.server },
		});
	});

	it('com o sort da página, o banco ordena e pagina, e o servidor só mede a página', async () => {
		const { adapter, envelopes } = selecting(
			[{ id: 7, status: 'open', geometry: northOf(150), 'geospatial:key:0': 'open', 'geospatial:key:1': 7 }],
			true,
			['geospatial:key:0', 'geospatial:key:1'],
		);
		const { engine } = onSqlite(adapter);
		const response = await radiusWith({ page: { fields: ['id'], sort: ['-status'], limit: 10, offset: 20 } }, engine);

		// One item past the page tells whether a next one exists.
		expect(envelopes.map(({ order, limit, offset }) => ({ order, limit, offset }))).toEqual([
			{ order: [{ field: 'status', direction: 'desc' }], limit: 11, offset: 20 },
		]);
		expect(response.data).toHaveLength(1);
		// The columns of the keys stay out of the item, as the fields the page did not ask.
		expect(response.data[0]).toEqual({ id: 7, $geo: expect.anything() as unknown });
		expect(response.data[0]?.$geo.distance).toBeCloseTo(150, 6);
	});

	it('o que o banco devolve sem linhas vira uma lista vazia', async () => {
		const { engine } = onSqlite(selecting({ rows: 'none' }).adapter);

		expect(await radiusWith({}, engine)).toEqual({ data: [] });
	});

	it('um campo que o banco não mede volta indisponível, com o motivo, depois da cadeia', async () => {
		const { engine, built } = onSqlite(selecting([], false).adapter);

		await expect(radiusWith({}, engine)).rejects.toMatchObject({
			status: 501,
			extensions: { operation: 'radius', reason: 'It only measures points on the database in use.' },
		});
		expect(built).toHaveLength(1);
	});
});

describe('o raio onde o banco mede', () => {
	const measuring = (row: Record<string, unknown>, converted?: string): MeasuringAdapter => ({
		columnOf: () => Promise.resolve({ type: 'geometry', srid: converted === undefined ? 4326 : 31_983 }),
		boxesIn: () => Promise.resolve(null),
		radius: () => ({
			builder: returning([row]),
			distance: 'far',
			keys: ['far', 'geospatial:key:1'],
			...(converted !== undefined && { converted }),
		}),
	});

	it.each([
		[
			'em 4326, a geometria exposta sai como veio',
			measuring({ id: 1, geometry: 'POINT(-46.7 -23.65)', far: 12.5, 'geospatial:key:1': '1' }),
		],
		[
			'em outro SRID, a geometria convertida toma o lugar da exposta',
			measuring(
				{ id: 1, geometry: 'POINT(333000 7383000)', far: 12.5, in4326: 'POINT(-46.7 -23.65)', 'geospatial:key:1': '1' },
				'in4326',
			),
		],
	])('%s, e a distância vem da coluna que o adaptador diz', async (_, adapter) => {
		const { engine } = engineWith({ levels: { ...radiusLevels, postgres: { level: 'indexed', adapter } } });

		expect(await radiusWith({ page: { fields: ['*'] } }, engine)).toEqual({
			data: [{ id: 1, geometry: 'POINT(-46.7 -23.65)', $geo: { distance: 12.5 } }],
		});
	});
});

describe('o cursor do raio (D-054)', () => {
	it.each([
		['com o offset', { fields: ['id'], offset: 10 }],
		['com a página', { fields: ['id'], page: 2 }],
	] satisfies [string, Query][])('%s, volta com o INVALID_QUERY, sem montar a query permitida', async (_, page) => {
		const { engine, built } = engineWith();
		const cursor = cursorOf(cursorKey, natural, [12.5, '1']);

		await expect(radiusWith({ page, cursor }, engine)).rejects.toMatchObject({
			code: 'INVALID_QUERY',
			extensions: { reason: 'The cursor does not go with the offset or the page' },
		});
		expect(built).toEqual([]);
	});

	it.each([
		['adulterado', `${cursorOf(cursorKey, natural, [12.5, '1']).slice(0, -2)}AA`],
		['de outra ordem', cursorOf(cursorKey, { ...natural, sort: ['-status'] }, ['open', '1'])],
	])('um cursor %s volta com o erro de entrada, sem montar a query permitida', async (_, cursor) => {
		const { engine, built } = engineWith();

		await expect(radiusWith({ cursor }, engine)).rejects.toMatchObject({ code: 'GEOSPATIAL_INVALID_INPUT' });
		expect(built).toEqual([]);
	});

	it('um cursor que não casa com a ordem que os hooks devolveram volta com o erro de entrada, antes do banco', async () => {
		const { engine } = engineWith({
			permittedQuery: (request, _, queryOf = (hooked) => hooked) => {
				const hooked = { ...request.query, sort: ['region', '-id'] };

				return Promise.resolve({
					builder: database.select('id').from('occurrences'),
					query: queryOf(hooked),
					fields: [],
				});
			},
		});

		await expect(radiusWith({ cursor: cursorOf(cursorKey, natural, [12.5, '1']) }, engine)).rejects.toMatchObject({
			code: 'GEOSPATIAL_INVALID_INPUT',
			extensions: { reason: 'The cursor is not one this list gave' },
		});
	});

	// An adapter of a database that measures, which hands back the rows given, with the distance and the key in the
	// columns it names, and keeps the envelopes it got.
	const measuringRows = (rows: Record<string, unknown>[]) => {
		const envelopes: RadiusEnvelope[] = [];
		const adapter: MeasuringAdapter = {
			columnOf: () => Promise.resolve({ type: 'geometry', srid: 4326 }),
			boxesIn: () => Promise.resolve(null),
			radius: (_, envelope) => {
				envelopes.push(envelope);

				return { builder: returning(rows), distance: 'far', keys: ['far', 'geospatial:key:1'] };
			},
		};

		return {
			envelopes,
			engine: engineWith({ levels: { ...radiusLevels, postgres: { level: 'indexed', adapter } } }).engine,
		};
	};

	const rowsAt = (...distances: number[]) =>
		distances.map((far, index) => ({
			id: index + 1,
			geometry: 'POINT(-46.7 -23.65)',
			far,
			'geospatial:key:1': String(index + 1),
		}));

	it('onde o banco mede, a página lê um item a mais, e o meta traz o cursor do último que ela mostra', async () => {
		const { engine, envelopes } = measuringRows(rowsAt(10, 20, 30));
		const response = await radiusWith({ page: { fields: ['id'], limit: 2 } }, engine);

		expect(envelopes.map(({ limit, offset, after }) => ({ limit, offset, after }))).toEqual([
			{ limit: 3, offset: 0, after: undefined },
		]);
		expect(response.data.map(({ id }) => id)).toEqual([1, 2]);
		expect(afterOf(cursorKey, natural, String(response.meta?.next))).toEqual([20, '2']);
	});

	it('com o cursor, o banco começa logo depois do último item, sem deslocamento, e a última página não traz cursor', async () => {
		const { engine, envelopes } = measuringRows(rowsAt(30));
		const response = await radiusWith(
			{ page: { fields: ['id'], limit: 2 }, cursor: cursorOf(cursorKey, natural, [20, '2']) },
			engine,
		);

		expect(envelopes.map(({ limit, offset, after }) => ({ limit, offset, after }))).toEqual([
			{ limit: 3, offset: 0, after: [20, '2'] },
		]);
		expect(response).toEqual({ data: [{ id: 1, $geo: { distance: 30 } }] });
	});

	it('onde o servidor mede, o cursor leva a distância e a chave, e a página seguinte começa depois deles', async () => {
		const { engine } = onSqlite(
			selecting([100, 200, 300].map((meters, index) => ({ id: index + 1, geometry: northOf(meters) }))).adapter,
		);
		const first = await radiusWith({ page: { fields: ['id'], limit: 2 } }, engine);
		const [distance, last] = afterOf(cursorKey, natural, String(first.meta?.next));

		expect(distance).toBeCloseTo(200, 6);
		expect(last).toBe(2);

		const second = await radiusWith({ page: { fields: ['id'], limit: 2 }, cursor: String(first.meta?.next) }, engine);

		expect(second.data.map(({ id }) => id)).toEqual([3]);
		expect(second).not.toHaveProperty('meta');
	});

	it('acima do limite do servidor, o meta traz o aviso e o cursor', async () => {
		const rows = Array.from({ length: limits.server + 1 }, (_, index) => ({ id: index + 1, geometry: northOf(10) }));
		const { engine } = onSqlite(selecting(rows).adapter);
		const { meta } = await radiusWith({ page: { fields: ['id'], limit: 1 } }, engine);

		expect(meta).toEqual({ capped: { limit: limits.server }, next: expect.any(String) as unknown });
	});
});

describe('os campos de cada item, como o /items os dá (V-183)', () => {
	it('a chave primária que a árvore do Directus não traz fica fora do item, como o /items a tira', async () => {
		const { engine } = engineWith({
			// A policy that lets the user read the region and the geometry, and not the key, which the * of the tree leaves out.
			permittedQuery: (request) =>
				Promise.resolve({
					builder: database.select('id', 'geometry').from('occurrences'),
					query: request.query,
					fields: ['region', 'geometry'],
				}),
			levels: {
				...radiusLevels,
				postgres: {
					level: 'indexed',
					adapter: {
						columnOf: () => Promise.resolve({ type: 'geometry', srid: 4326 }),
						boxesIn: () => Promise.resolve(null),
						radius: () => ({
							builder: returning([
								{ id: 1, region: 'south', geometry: 'POINT(-46.7 -23.65)', far: 0, 'geospatial:key:1': '1' },
							]),
							distance: 'far',
							keys: ['far', 'geospatial:key:1'],
						}),
					},
				},
			},
		});

		expect(await radiusWith({ page: { fields: ['*'] } }, engine)).toEqual({
			data: [{ region: 'south', geometry: 'POINT(-46.7 -23.65)', $geo: { distance: 0 } }],
		});
	});
});

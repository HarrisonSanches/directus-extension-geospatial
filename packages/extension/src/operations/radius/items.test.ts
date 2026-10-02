import type { Accountability, Query, SchemaOverview } from '@directus/types';
import type { Internals, Radius } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import type { Request } from '../../internals/chain.js';
import { database } from '../../internals/fake-directus.js';
import { type Engine, itemsOf, radiusItems, type RadiusRequest, unaskedOf } from './items.js';

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
		// With no hook of items.query, the chain gets what the radius asks of the page as it came.
		permittedQuery: (request, _, queryOf = (hooked) => hooked) => {
			built.push({ ...request, query: queryOf(request.query) });

			return Promise.resolve({ builder: database.select('id', 'geometry').from('occurrences'), query: request.query });
		},
		logger: { error: (error: unknown) => logged.push(error) },
		valuesOf: (_, rows) => Promise.resolve(rows),
		defaultLimit: 100,
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
		['um banco onde o raio não roda', {}, { client: 'sqlite' as const }, 'GEOSPATIAL_OPERATION_UNAVAILABLE'],
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
			code: 'INVALID_QUERY',
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

				return Promise.resolve({ builder: database.select('id').from('occurrences'), query: queryOf(hooked) });
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

	it('cada item leva a distância no $geo, sem os campos que a página não pediu', () => {
		const values = [
			{ id: 1, status: 'open', geometry: { type: 'Point', coordinates: [-46.7, -23.65] } },
			{ id: 2, status: 'closed', geometry: { type: 'Point', coordinates: [-46.7, -23.6] } },
		];

		expect(itemsOf(values, [0, 5_558.6], ['status', 'geometry'])).toEqual([
			{ id: 1, $geo: { distance: 0 } },
			{ id: 2, $geo: { distance: 5_558.6 } },
		]);
	});
});

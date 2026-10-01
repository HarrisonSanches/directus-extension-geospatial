import type { Accountability, Query, SchemaOverview } from '@directus/types';
import type { Internals, Radius } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import type { Request } from '../../internals/chain.js';
import { database } from '../../internals/fake-directus.js';
import { type Engine, radiusItems, type RadiusRequest } from './items.js';

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
		permittedQuery: (request) => {
			built.push(request);

			return Promise.resolve({ builder: database.select('id', 'geometry').from('occurrences') });
		},
		logger: { error: (error: unknown) => logged.push(error) },
		valuesOf: (_, rows) => Promise.resolve(rows),
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
		['um parâmetro que o raio ainda não trata', { page: { fields: ['*'], sort: ['region'] } }, {}, 'INVALID_QUERY'],
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

describe('a query permitida do raio', () => {
	it.each([
		['a página toda', { fields: ['id'], limit: 10, offset: 5 }, ['id', 'geometry']],
		['a página pelo número', { fields: ['id', 'region'], limit: 10, page: 3 }, ['id', 'region', 'geometry']],
		['sem os campos', { limit: -1 }, ['*', 'geometry']],
	])('%s: sai sem limite, sem deslocamento e sem página, com a geometria pelo nome', async (_, page: Query, fields) => {
		const { engine, built } = engineWith();

		await radiusWith({ page }, engine).catch(() => undefined);

		expect(built).toEqual([{ collection: 'occurrences', query: { fields, limit: -1 }, accountability: maria }]);
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

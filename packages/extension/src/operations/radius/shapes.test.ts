import { ForbiddenError } from '@directus/errors';
import type { Accountability, SchemaOverview } from '@directus/types';
import type { Internals, Radius } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import type { Request } from '../../internals/chain.js';
import { database } from '../../internals/fake-directus.js';
import { circleOf } from './circle.js';
import type { Checking, RadiusRequest } from './items.js';
import { radiusLevels } from './levels.js';
import { radiusShapes } from './shapes.js';

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
		directus_users: {
			collection: 'directus_users',
			primary: 'id',
			fields: { id: { field: 'id', type: 'uuid' }, location: { field: 'location', type: 'geometry.Point' } },
		},
	},
	relations: [],
} as unknown as SchemaOverview;

const geo: Radius = { operation: 'radius', center: [-46.7, -23.65], distance: 1000 };

// The engine over the fake Directus: the chain hands back a query of the Knex that never connects, which fails as a
// database that went down if anything runs it.
const engineWith = (overrides: Partial<Checking> = {}) => {
	const built: Request[] = [];
	const engine: Checking = {
		knex: database,
		schema,
		client: 'postgres',
		internals: () => Promise.resolve({ status: 'accepted', adapter: '12' }),
		permittedQuery: (request, _, queryOf = (hooked) => hooked) => {
			const query = queryOf(request.query);

			built.push({ ...request, query });

			return Promise.resolve({
				builder: database.select('id', 'geometry').from('occurrences'),
				query: request.query,
				fields: ['id', 'geometry', 'region'],
			});
		},
		defaultLimit: 100,
		levels: radiusLevels,
		...overrides,
	};

	return { engine, built };
};

const shapesWith = (request: Partial<RadiusRequest>, engine: Checking) =>
	radiusShapes({ collection: 'occurrences', geo, page: { fields: ['*'] }, accountability: maria, ...request }, engine);

const circle = {
	data: {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: circleOf(geo.center, geo.distance),
				properties: { center: geo.center, distance: geo.distance },
			},
		],
	},
};

const refused: Internals = { status: 'refused', problems: { '12': ['missing'] } };

describe('as formas do raio (D-022)', () => {
	it('são o círculo, com o centro e a distância nas propriedades, depois da query permitida, montada e não rodada', async () => {
		const { engine, built } = engineWith();

		expect(await shapesWith({}, engine)).toEqual(circle);
		// The geometry goes by its name, as for the items, so whoever cannot read it gets the error of /items.
		expect(built.map(({ query }) => query.fields)).toEqual([['*', 'geometry']]);
	});

	it('no banco onde o servidor completa o raio, o círculo é o mesmo', async () => {
		const { engine } = engineWith({ client: 'sqlite' });

		expect(await shapesWith({}, engine)).toEqual(circle);
	});

	it('quem a cadeia recusa recebe o erro dela, o do /items', async () => {
		const { engine } = engineWith({ permittedQuery: () => Promise.reject(new ForbiddenError()) });

		await expect(shapesWith({}, engine)).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it.each([
		['um cursor, que a lista de uma forma só nunca dá', { cursor: 'AAAA' }, {}, 'GEOSPATIAL_INVALID_INPUT'],
		['o limit acima do máximo do contrato', { page: { fields: ['*'], limit: 1001 } }, {}, 'INVALID_QUERY'],
		['os internos recusados', {}, { internals: () => Promise.resolve(refused) }, 'GEOSPATIAL_INTERNALS_UNSUPPORTED'],
		['um banco onde o raio não roda', {}, { client: 'mysql' as const }, 'GEOSPATIAL_OPERATION_UNAVAILABLE'],
		['uma coleção que o esquema não tem', { collection: 'nowhere' }, {}, 'FORBIDDEN'],
		['uma coleção do sistema, mesmo com uma geometria', { collection: 'directus_users' }, {}, 'FORBIDDEN'],
	])('%s volta com o erro, sem montar a query permitida', async (_, request, overrides, code) => {
		const { engine, built } = engineWith(overrides);

		await expect(shapesWith(request, engine)).rejects.toMatchObject({ code });
		expect(built).toEqual([]);
	});

	it('um campo que não é de geometria passa primeiro pela cadeia, que recusa quem não lê a coleção', async () => {
		const { engine, built } = engineWith();

		await expect(shapesWith({ geo: { ...geo, field: 'region' } }, engine)).rejects.toMatchObject({
			code: 'GEOSPATIAL_INVALID_INPUT',
			extensions: { reason: 'The field region of occurrences is not a geometry' },
		});
		expect(built.map(({ query }) => query.fields)).toEqual([['*']]);
	});
});

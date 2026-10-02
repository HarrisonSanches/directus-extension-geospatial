import { CollectionInactiveError, ForbiddenError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import type { Internals } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import {
	context,
	directus11,
	directus12,
	FakeEmitter,
	type FakeModules,
	loaderOf,
	nothingReceived,
	withArity,
} from './fake-directus.js';
import { permittedQueryWith } from './permitted.js';

const request = { collection: 'occurrences', query: {}, accountability: null };

const maria: Accountability = {
	role: 'operator',
	roles: ['operator'],
	user: 'maria',
	admin: false,
	app: true,
	ip: null,
};

const logged: unknown[] = [];
const logger = { error: (error: unknown) => logged.push(error) };

const permittedWith = (internals: Internals, modules: FakeModules) =>
	permittedQueryWith(() => Promise.resolve(internals), logger, loaderOf(modules));

describe('a query permitida pelo adaptador que a checagem aceitou', () => {
	it.each([
		['11.17', directus11()],
		['12', directus12()],
	] as const)('o adaptador %s monta a query da coleção, sem rodar', async (adapter, modules) => {
		const { builder } = await permittedWith({ status: 'accepted', adapter }, modules)(request, context);

		expect(builder.toSQL().sql).toBe('select "collection" from "occurrences"');
	});

	it('com os internos recusados, a operação responde que eles não servem, sem montar nada', async () => {
		const permitted = permittedWith({ status: 'refused', problems: { '12': ['missing'] } }, {});

		await expect(permitted(request, context)).rejects.toMatchObject({
			code: 'GEOSPATIAL_INTERNALS_UNSUPPORTED',
			status: 503,
		});
	});

	it('um passo que devolve outra forma na hora do pedido desliga a operação do mesmo jeito, e vai para o log', async () => {
		const modules: FakeModules = {
			...directus11(),
			'database/run-ast/lib/get-db-query': { getDBQuery: withArity(2, () => ({ rows: [] })) },
		};

		logged.length = 0;

		await expect(
			permittedWith({ status: 'accepted', adapter: '11.17' }, modules)(request, context),
		).rejects.toMatchObject({ code: 'GEOSPATIAL_INTERNALS_UNSUPPORTED' });
		expect(logged).toEqual([
			expect.objectContaining({ message: 'getDBQuery returned something other than a query builder.' }),
		]);
	});

	it('um erro do Directus, como o de permissão, passa como veio', async () => {
		const modules: FakeModules = {
			...directus11(),
			'permissions/modules/process-ast/process-ast': {
				processAst: withArity(2, () => Promise.reject(new ForbiddenError())),
			},
		};

		await expect(
			permittedWith({ status: 'accepted', adapter: '11.17' }, modules)(request, context),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

describe('os hooks de items.query de outras extensões (V-144)', () => {
	const accountability = { ...maria };

	// A hook of another extension, on the event of the collection, that leaves only the open occurrences.
	const openOnly = () => {
		const emitter = new FakeEmitter();

		emitter.filter('occurrences.items.query', (query) => ({ ...query, filter: { status: { _eq: 'open' } } }));

		return emitter;
	};

	it.each(['11.17', '12'] as const)(
		'no %s, recebem a página como o /items a passa, antes da cadeia, que monta o que eles devolveram',
		async (adapter) => {
			const emitter = openOnly();
			const received = nothingReceived();
			const modules = adapter === '12' ? directus12(received, emitter) : directus11(received, emitter);
			const asked: unknown[] = [];
			const page = { fields: ['*'], limit: 10 };

			const { query } = await permittedWith({ status: 'accepted', adapter }, modules)(
				{ collection: 'occurrences', query: page, accountability },
				context,
				(hooked) => {
					asked.push(hooked);

					return { ...hooked, limit: -1 };
				},
			);

			const hooked = { ...page, filter: { status: { _eq: 'open' } } };

			expect(emitter.emitted).toEqual([
				{
					events: ['items.query', 'occurrences.items.query'],
					query: page,
					meta: { collection: 'occurrences' },
					context: { database: context.knex, schema: context.schema, accountability },
				},
			]);
			expect(query).toEqual(hooked);
			expect(asked).toEqual([hooked]);
			expect(received.getAstFromQuery).toEqual([
				{ collection: 'occurrences', query: { ...hooked, limit: -1 }, accountability },
			]);
		},
	);

	it('no 12, uma coleção inativa é recusada antes dos hooks, como no readByQuery (V-142)', async () => {
		const emitter = openOnly();
		const modules: FakeModules = {
			...directus12(undefined, emitter),
			'permissions/modules/assert-collection-active/assert-collection-active': {
				assertCollectionActive: withArity(2, () =>
					Promise.reject(new CollectionInactiveError({ collection: 'occurrences' })),
				),
			},
		};

		await expect(
			permittedWith({ status: 'accepted', adapter: '12' }, modules)(
				{ collection: 'occurrences', query: {}, accountability },
				context,
			),
		).rejects.toMatchObject({ code: 'COLLECTION_INACTIVE' });
		expect(emitter.emitted).toEqual([]);
	});
});

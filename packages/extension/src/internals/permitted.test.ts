import { CollectionInactiveError, ForbiddenError } from '@directus/errors';
import type { Accountability, Query } from '@directus/types';
import type { Item } from 'directus-geospatial-contract';
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
const logger = { error: (...entry: unknown[]) => logged.push(entry) };

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
			[
				expect.objectContaining({ message: 'getDBQuery returned something other than a query builder.' }),
				'The internals of Directus changed shape, so the geospatial operations are off',
			],
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

		emitter.filter<Query>('occurrences.items.query', (query) => ({ ...query, filter: { status: { _eq: 'open' } } }));

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
					payload: page,
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

	it('sem o que fazer da página, a cadeia monta a que os hooks devolveram', async () => {
		const received = nothingReceived();
		const page = { fields: ['*'], limit: 10 };

		await permittedWith({ status: 'accepted', adapter: '11.17' }, directus11(received, openOnly()))(
			{ collection: 'occurrences', query: page, accountability },
			context,
		);

		expect(received.getAstFromQuery).toEqual([
			{ collection: 'occurrences', query: { ...page, filter: { status: { _eq: 'open' } } }, accountability },
		]);
	});

	it('no 12, a coleção é conferida para a ação read de quem pede, antes dos hooks', async () => {
		const received = nothingReceived();

		await permittedWith({ status: 'accepted', adapter: '12' }, directus12(received))(
			{ collection: 'occurrences', query: {}, accountability },
			context,
		);

		expect(received.assertCollectionActive).toEqual([{ accountability, collection: 'occurrences', action: 'read' }]);
	});

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

describe('os hooks de items.read de outras extensões, nas listas de itens (A-045)', () => {
	const accountability = { ...maria };
	const page = { fields: ['id', 'region'], limit: 10 };
	const eventContext = { database: context.knex, schema: context.schema, accountability };

	// A hook of another extension, on the event of the collection, that hides the region of each item it reads.
	const regionHidden = () => {
		const emitter = new FakeEmitter();

		emitter.filter<Item[]>('occurrences.items.read', (items) => items.map((item) => ({ ...item, region: null })));

		return emitter;
	};

	const items: Item[] = [
		{ id: 1, region: 'south', $geo: { distance: 120 } },
		{ id: 2, region: 'south', $geo: { distance: 340 } },
	];

	it.each(['11.17', '12'] as const)(
		'no %s, o filtro recebe os itens como a lista os dá, e a lista é o que ele devolve',
		async (adapter) => {
			const emitter = regionHidden();
			const modules = adapter === '12' ? directus12(undefined, emitter) : directus11(undefined, emitter);
			const { read, query } = await permittedWith({ status: 'accepted', adapter }, modules)(
				{ collection: 'occurrences', query: page, accountability },
				context,
			);

			expect(await read(items)).toEqual([
				{ id: 1, region: null, $geo: { distance: 120 } },
				{ id: 2, region: null, $geo: { distance: 340 } },
			]);
			expect(emitter.emitted.at(-1)).toEqual({
				events: ['items.read', 'occurrences.items.read'],
				payload: items,
				meta: { query, collection: 'occurrences' },
				context: eventContext,
			});
		},
	);

	it('a ação vem depois do filtro, com o que ele devolveu, como no readByQuery (V-174)', async () => {
		const emitter = regionHidden();
		const { read, query } = await permittedWith({ status: 'accepted', adapter: '12' }, directus12(undefined, emitter))(
			{ collection: 'occurrences', query: page, accountability },
			context,
		);

		const filtered = await read(items);

		expect(emitter.acted).toEqual([
			{
				events: ['items.read', 'occurrences.items.read'],
				meta: { payload: filtered, query, collection: 'occurrences' },
				context: eventContext,
			},
		]);
		expect(emitter.order).toEqual(['filter', 'filter', 'action']);
	});

	it('a query permitida sozinha não emite o items.read, que só a lista pede', async () => {
		const emitter = regionHidden();

		await permittedWith({ status: 'accepted', adapter: '12' }, directus12(undefined, emitter))(
			{ collection: 'occurrences', query: page, accountability },
			context,
		);

		expect(emitter.order).toEqual(['filter']);
		expect(emitter.acted).toEqual([]);
	});
});

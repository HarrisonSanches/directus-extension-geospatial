import type { Accountability } from '@directus/types';
import { describe, expect, it } from 'vitest';
import { chain } from './chain.js';
import { context, directus11, nothingReceived, permission, withArity } from './fake-directus.js';
import { InternalsMismatchError, type ModulePath, takeFrom } from './modules.js';

const maria: Accountability = {
	role: 'operator',
	roles: ['operator'],
	user: 'maria',
	admin: false,
	app: true,
	ip: null,
};
const admin: Accountability = { ...maria, role: 'admin', roles: ['admin'], user: 'admin', admin: true };

const chainAs = async (accountability: Accountability | null) => {
	const received = nothingReceived();
	const take = takeFrom(new Map(Object.entries(directus11(received))));
	const { builder } = await chain(take, { collection: 'occurrences', query: {}, accountability }, context);

	return { builder, received };
};

describe('a cadeia do ItemsService até o getDBQuery', () => {
	it('quem não é admin lê com as permissões das políticas dele', async () => {
		const { received } = await chainAs(maria);

		expect(received.fetchPolicies).toEqual([maria]);
		expect(received.getDBQuery).toEqual([expect.objectContaining({ table: 'occurrences', permissions: [permission] })]);
	});

	it.each([
		['o admin', admin],
		['o pedido sem accountability', null],
	])('%s lê sem permissão nenhuma, e sem ler as políticas', async (_, accountability) => {
		const { received } = await chainAs(accountability);

		expect(received.fetchPolicies).toEqual([]);
		expect(received.getDBQuery).toEqual([expect.objectContaining({ permissions: [] })]);
	});

	it('lê para a ação read, a do /items: o processAst e as permissões das políticas de quem pede', async () => {
		const { received } = await chainAs(maria);

		expect(received.processAst).toEqual([expect.objectContaining({ action: 'read', accountability: maria })]);
		expect(received.fetchPermissions).toEqual([
			{ action: 'read', accountability: maria, policies: [permission.policy] },
		]);
	});

	it('passa ao getDBQuery só as relações de um para muitos do nível', async () => {
		const received = nothingReceived();
		const o2m = { type: 'o2m', name: 'comments', fieldKey: 'comments' };
		const modules = {
			...directus11(received),
			'database/run-ast/lib/parse-current-level': {
				parseCurrentLevel: withArity(4, () =>
					Promise.resolve({
						fieldNodes: [],
						nestedCollectionNodes: [o2m, { type: 'm2o', name: 'author', fieldKey: 'author' }],
					}),
				),
			},
		};

		await chain(
			takeFrom(new Map(Object.entries(modules))),
			{ collection: 'occurrences', query: {}, accountability: maria },
			context,
		);

		expect(received.getDBQuery).toEqual([expect.objectContaining({ o2mNodes: [o2m] })]);
	});

	it('devolve os campos da árvore, os que o Directus deixa em cada item depois de ler (removeTemporaryFields)', async () => {
		const take = takeFrom(new Map(Object.entries(directus11())));
		const { fields } = await chain(take, { collection: 'occurrences', query: {}, accountability: maria }, context);

		expect(fields).toEqual(['collection']);
	});

	it('uma árvore cujo nó não traz a chave do campo é outra forma, e a operação se desliga', async () => {
		const modules = {
			...directus11(),
			'database/get-ast-from-query/get-ast-from-query': {
				getAstFromQuery: withArity(2, () =>
					Promise.resolve({ type: 'root', name: 'occurrences', children: [{ type: 'field' }], query: {}, cases: [] }),
				),
			},
		};

		await expect(
			chain(
				takeFrom(new Map(Object.entries(modules))),
				{ collection: 'occurrences', query: {}, accountability: maria },
				context,
			),
		).rejects.toThrow('getAstFromQuery returned something other than a tree of fields.');
	});

	const node = { type: 'field', name: 'collection', fieldKey: 'collection' };
	const tree = { type: 'root', name: 'occurrences', children: [node], query: {}, cases: [] };

	// The chain, with a step of Directus that returns what the test gives.
	const chainWith = (path: ModulePath, step: string, returned: unknown) =>
		chain(
			takeFrom(
				new Map(
					Object.entries({
						...directus11(),
						[path]: { [step]: withArity(step === 'parseCurrentLevel' ? 4 : 2, () => returned) },
					}),
				),
			),
			{ collection: 'occurrences', query: {}, accountability: maria },
			context,
		);

	it.each([
		['nada', null],
		['um texto', 'root'],
		['uma árvore que não é a raiz', { ...tree, type: 'field' }],
		['uma árvore sem o nome da coleção', { ...tree, name: 1 }],
		['uma árvore sem a lista dos filhos', { ...tree, children: {} }],
		['um filho fora de um objeto', { ...tree, children: [node, null] }],
		['um filho sem o tipo', { ...tree, children: [node, { ...node, type: 1 }] }],
		['uma árvore sem a query', { ...tree, query: null }],
		['uma árvore sem a lista dos casos', { ...tree, cases: {} }],
	])('o processAst que devolve %s é outra forma, e a operação se desliga', async (_, returned) => {
		await expect(
			chainWith('permissions/modules/process-ast/process-ast', 'processAst', Promise.resolve(returned)),
		).rejects.toThrow(new InternalsMismatchError('processAst returned something other than a tree of fields.'));
	});

	it.each([
		['nada', null],
		['os campos fora de uma lista', { fieldNodes: {}, nestedCollectionNodes: [] }],
		['um campo sem a chave', { fieldNodes: [node, { type: 'field' }], nestedCollectionNodes: [] }],
		['as relações fora de uma lista', { fieldNodes: [node], nestedCollectionNodes: null }],
		['uma relação sem a chave', { fieldNodes: [node], nestedCollectionNodes: [{ type: 'o2m' }] }],
	])('o parseCurrentLevel que devolve %s é outra forma, e a operação se desliga', async (_, returned) => {
		await expect(
			chainWith('database/run-ast/lib/parse-current-level', 'parseCurrentLevel', Promise.resolve(returned)),
		).rejects.toThrow(
			new InternalsMismatchError('parseCurrentLevel returned something other than the nodes of a level.'),
		);
	});

	it.each([
		['nada', null],
		['um objeto sem o toSQL', { sql: 'select 1' }],
	])('o getDBQuery que devolve %s é outra forma, e a operação se desliga', async (_, returned) => {
		await expect(chainWith('database/run-ast/lib/get-db-query', 'getDBQuery', returned)).rejects.toThrow(
			new InternalsMismatchError('getDBQuery returned something other than a query builder.'),
		);
	});

	// The builder has a then of its own, and Knex without a connection would fail to run it.
	it('devolve o builder dentro de um objeto, sem rodar a query', async () => {
		const { builder } = await chainAs(maria);

		expect(builder.toSQL().sql).toBe('select "collection" from "occurrences"');
	});
});

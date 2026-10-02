import type { Accountability } from '@directus/types';
import { describe, expect, it } from 'vitest';
import { chain } from './chain.js';
import { context, directus11, nothingReceived, permission, withArity } from './fake-directus.js';
import { takeFrom } from './modules.js';

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

	it('passa ao getDBQuery só as relações de um para muitos do nível', async () => {
		const received = nothingReceived();
		const o2m = { type: 'o2m', name: 'comments' };
		const modules = {
			...directus11(received),
			'database/run-ast/lib/parse-current-level': {
				parseCurrentLevel: withArity(4, () =>
					Promise.resolve({ fieldNodes: [], nestedCollectionNodes: [o2m, { type: 'm2o', name: 'author' }] }),
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

	// The builder has a then of its own, and Knex without a connection would fail to run it.
	it('devolve o builder dentro de um objeto, sem rodar a query', async () => {
		const { builder } = await chainAs(maria);

		expect(builder.toSQL().sql).toBe('select "collection" from "occurrences"');
	});
});

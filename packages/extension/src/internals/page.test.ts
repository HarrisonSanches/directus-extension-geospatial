import type { Internals } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { context, directus11, directus12, type FakeModules, loaderOf, withArity } from './fake-directus.js';
import { pageQueryWith } from './page.js';

const logged: unknown[] = [];
const logger = { error: (error: unknown) => logged.push(error) };

const pageWith = (internals: Internals, modules: FakeModules) =>
	pageQueryWith(() => Promise.resolve(internals), logger, loaderOf(modules));

describe('a query do corpo de um SEARCH, lida como o Directus lê a dele (V-181)', () => {
	it.each([
		['11.17', directus11()],
		['12', directus12()],
	] as const)('o adaptador %s a sanitiza e a valida pelo Directus em execução', async (adapter, modules) => {
		const page = pageWith({ status: 'accepted', adapter }, modules);

		expect(await page({ fields: 'id,region', limit: 5 }, context.schema, undefined)).toEqual({
			fields: ['id', 'region'],
			limit: 5,
		});
	});

	it('com os internos recusados, o pedido não segue', async () => {
		const page = pageWith({ status: 'refused', problems: { '12': ['missing'] } }, {});

		await expect(page({}, context.schema, undefined)).rejects.toMatchObject({
			code: 'GEOSPATIAL_INTERNALS_UNSUPPORTED',
		});
	});

	it('a accountability do pedido vai ao Directus, e sem ela, o null que o Directus lê como ele mesmo', async () => {
		const received: unknown[] = [];
		const modules = directus12();
		const spying: FakeModules = {
			...modules,
			'utils/sanitize-query': {
				sanitizeQuery: withArity(3, (raw: unknown, _: unknown, accountability: unknown) => {
					received.push(accountability);

					return Promise.resolve(raw);
				}),
			},
		};
		const page = pageWith({ status: 'accepted', adapter: '12' }, spying);
		const maria = { user: 'maria', role: 'operator', roles: ['operator'], admin: false, app: true, ip: null };

		await page({}, context.schema, maria);
		await page({}, context.schema, undefined);

		expect(received).toEqual([maria, null]);
	});

	it('uma função que mudou de forma na hora do pedido desliga as operações, com a forma só no log', async () => {
		// The module is there, without the function, as a Directus that moved it elsewhere.
		const page = pageWith({ status: 'accepted', adapter: '12' }, { ...directus12(), 'utils/validate-query': {} });

		logged.length = 0;

		await expect(page({}, context.schema, undefined)).rejects.toMatchObject({
			code: 'GEOSPATIAL_INTERNALS_UNSUPPORTED',
		});
		expect(logged).toHaveLength(1);
	});
});

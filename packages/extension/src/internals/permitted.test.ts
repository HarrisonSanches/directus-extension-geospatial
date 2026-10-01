import { ForbiddenError } from '@directus/errors';
import type { Internals } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { context, directus11, directus12, type FakeModules, loaderOf, withArity } from './fake-directus.js';
import { permittedQueryWith } from './permitted.js';

const request = { collection: 'occurrences', query: {}, accountability: null };

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

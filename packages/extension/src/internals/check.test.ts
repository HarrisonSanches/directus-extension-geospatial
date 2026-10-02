import { describe, expect, it } from 'vitest';
import { adapters } from './adapters.js';
import { checkInternals } from './check.js';
import {
	context,
	database,
	directus11,
	directus12,
	FakeEmitter,
	type FakeModules,
	loaderOf,
	withArity,
} from './fake-directus.js';
import type { Load } from './modules.js';

const check = (modules: FakeModules, only?: string) =>
	checkInternals(
		adapters.filter(({ name }) => only === undefined || name === only),
		loaderOf(modules),
		context,
	);

const assertCollectionActive = '@directus/api/permissions/modules/assert-collection-active/assert-collection-active';
const getDBQuery = '@directus/api/database/run-ast/lib/get-db-query';

describe('o adaptador escolhido pelo que o Directus em execução tem', () => {
	it('o Directus 12 passa no adaptador do 12', async () => {
		expect(await check(directus12())).toEqual({ status: 'accepted', adapter: '12' });
	});

	it('o Directus 11.17 passa no adaptador do 11.17, depois de recusar o do 12', async () => {
		expect(await check(directus11())).toEqual({ status: 'accepted', adapter: '11.17' });
	});
});

describe('cada adaptador forçado na outra versão (V-146)', () => {
	it('o do 11.17 recusa o Directus 12, que tem o assert-collection-active', async () => {
		expect(await check(directus12(), '11.17')).toEqual({
			status: 'refused',
			problems: {
				'11.17': [
					`${assertCollectionActive} exists, and this Directus refuses an inactive collection before the hooks of items.query, which this adapter does not`,
				],
			},
		});
	});

	it('o do 12 recusa o Directus 11.17, que não tem o assert-collection-active', async () => {
		expect(await check(directus11(), '12')).toEqual({
			status: 'refused',
			problems: { '12': [`${assertCollectionActive} could not be imported (ERR_MODULE_NOT_FOUND)`] },
		});
	});
});

describe('a checagem recusa o que não é o que o adaptador espera', () => {
	it('um módulo que falta, com o que falta em cada adaptador', async () => {
		const modules = directus12();

		delete modules['database/run-ast/lib/get-db-query'];

		expect(await check(modules)).toEqual({
			status: 'refused',
			problems: {
				'12': [`${getDBQuery} could not be imported (ERR_MODULE_NOT_FOUND)`],
				'11.17': [
					`${getDBQuery} could not be imported (ERR_MODULE_NOT_FOUND)`,
					`${assertCollectionActive} exists, and this Directus refuses an inactive collection before the hooks of items.query, which this adapter does not`,
				],
			},
		});
	});

	it('um módulo sem a função', async () => {
		const modules = { ...directus12(), 'database/run-ast/lib/get-db-query': { getQuery: () => null } };

		expect(await check(modules, '12')).toEqual({
			status: 'refused',
			problems: { '12': [`${getDBQuery} has no function getDBQuery`] },
		});
	});

	it('uma função com outra aridade', async () => {
		const modules = {
			...directus12(),
			'database/run-ast/lib/get-db-query': { getDBQuery: withArity(3, () => null) },
		};

		expect(await check(modules, '12')).toEqual({
			status: 'refused',
			problems: { '12': [`${getDBQuery}: getDBQuery declares 3 parameters, and the adapter expects 2`] },
		});
	});

	it.each([
		[
			'getAstFromQuery',
			'database/get-ast-from-query/get-ast-from-query',
			withArity(2, () => Promise.resolve({ type: 'root' })),
			'a tree of fields',
		],
		[
			'processAst',
			'permissions/modules/process-ast/process-ast',
			withArity(2, () => Promise.resolve([])),
			'a tree of fields',
		],
		[
			'parseCurrentLevel',
			'database/run-ast/lib/parse-current-level',
			withArity(4, () => Promise.resolve({ fieldNodes: [{ name: 'collection' }], nestedCollectionNodes: [] })),
			'the nodes of a level',
		],
		['getDBQuery', 'database/run-ast/lib/get-db-query', withArity(2, () => 'select 1'), 'a query builder'],
	])('um passo que devolve outra forma: o %s', async (step, path, fn, shape) => {
		const modules = { ...directus12(), [path]: { [step]: fn } };

		expect(await check(modules, '12')).toEqual({
			status: 'refused',
			problems: {
				'12': [`the chain failed on directus_collections: ${step} returned something other than ${shape}.`],
			},
		});
	});

	it('uma cadeia que monta a query de outra coleção', async () => {
		const builder = database.select('id').from('directus_users');
		const modules = {
			...directus12(),
			'database/run-ast/lib/get-db-query': { getDBQuery: withArity(2, () => builder) },
		};

		expect(await check(modules, '12')).toEqual({
			status: 'refused',
			problems: {
				'12': ['the chain built a query that does not read directus_collections: select "id" from "directus_users"'],
			},
		});
	});

	it('um passo que falha, com o motivo', async () => {
		const modules = {
			...directus12(),
			'permissions/modules/assert-collection-active/assert-collection-active': {
				assertCollectionActive: withArity(2, () => Promise.reject(new Error('The collection is not active.'))),
			},
		};

		expect(await check(modules, '12')).toEqual({
			status: 'refused',
			problems: { '12': ['the chain failed on directus_collections: The collection is not active.'] },
		});
	});

	it('um import que falha por outro motivo, e o que não é um módulo', async () => {
		const loaded = loaderOf(directus12());
		const load: Load = (path) => {
			if (path === 'permissions/modules/assert-collection-active/assert-collection-active') {
				return Promise.reject(new SyntaxError('Unexpected token'));
			}

			return path === 'database/run-ast/lib/get-db-query' ? Promise.resolve('getDBQuery') : loaded(path);
		};

		expect(await checkInternals(adapters, load, context)).toEqual({
			status: 'refused',
			problems: {
				'12': [
					`${getDBQuery} could not be imported (not a module)`,
					`${assertCollectionActive} could not be imported (SyntaxError: Unexpected token)`,
				],
				'11.17': [
					`${getDBQuery} could not be imported (not a module)`,
					`${assertCollectionActive} could not be imported (SyntaxError: Unexpected token), so the check cannot tell whether this Directus refuses an inactive collection before the hooks of items.query, which this adapter does not`,
				],
			},
		});
	});
});

describe('o emissor dos eventos do núcleo, que os hooks de items.query ouvem (V-144)', () => {
	const emitter = '@directus/api/emitter';

	it('sem o emissor, nenhum adaptador serve', async () => {
		const modules = directus12();

		delete modules.emitter;

		expect(await check(modules, '12')).toEqual({
			status: 'refused',
			problems: { '12': [`${emitter} could not be imported (ERR_MODULE_NOT_FOUND)`] },
		});
	});

	it.each([
		['sem o emitFilter', { default: {} }, `${emitter} has no function emitFilter`],
		[
			'com o emitFilter fora do objeto padrão',
			{ emitFilter: withArity(3, () => null) },
			`${emitter} has no function emitFilter`,
		],
		[
			'com o emitFilter de outra aridade',
			{ default: { emitFilter: withArity(4, () => null) } },
			`${emitter}: emitFilter declares 4 parameters, and the adapter expects 3`,
		],
	])('%s, o adaptador recusa o Directus', async (_, module, problem) => {
		expect(await check({ ...directus12(), emitter: module }, '12')).toEqual({
			status: 'refused',
			problems: { '12': [problem] },
		});
	});

	it('a checagem não emite evento nenhum, então nenhum hook de outra extensão roda na partida', async () => {
		const fake = new FakeEmitter();

		expect(await check(directus12(undefined, fake))).toEqual({ status: 'accepted', adapter: '12' });
		expect(fake.emitted).toEqual([]);
	});
});

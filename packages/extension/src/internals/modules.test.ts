import { describe, expect, it } from 'vitest';
import { adapters } from './adapters.js';
import { checkInternals } from './check.js';
import { context, directus11, withArity } from './fake-directus.js';
import { functions, InternalsMismatchError, load, takeFrom } from './modules.js';

describe('os módulos do Directus em execução', () => {
	it('uma função que a checagem não carregou falha, com o nome dela', () => {
		const take = takeFrom(new Map(Object.entries(directus11())));

		expect(() => take('assertCollectionActive')).toThrow(
			new InternalsMismatchError(
				'The running Directus has no assertCollectionActive with the arity the adapter expects.',
			),
		);
	});

	it('na hora do pedido, uma função com outra aridade falha como a que falta', () => {
		const modules = { ...directus11(), 'database/run-ast/lib/get-db-query': { getDBQuery: withArity(3, () => null) } };
		const take = takeFrom(new Map(Object.entries(modules)));

		expect(() => take('getDBQuery')).toThrow(
			new InternalsMismatchError('The running Directus has no getDBQuery with the arity the adapter expects.'),
		);
	});

	it('um módulo que carregou como nada não tem o emissor, e o pedido falha como na função que falta', () => {
		const take = takeFrom(new Map(Object.entries({ ...directus11(), emitter: null })));

		expect(() => take('emitFilter')).toThrow(
			new InternalsMismatchError('The running Directus has no emitFilter with the arity the adapter expects.'),
		);
	});

	// Outside Directus, @directus/api is not installed (V-141), as a Directus without any of the modules would be.
	it('fora de um Directus, o carregador de verdade não acha módulo nenhum, e a checagem recusa', async () => {
		const result = await checkInternals(adapters, load, context);
		const problems = result.status === 'refused' ? result.problems : {};

		expect(result.status).toBe('refused');

		// Each module once, also the emitter, which two functions share.
		for (const { name, uses } of adapters) {
			expect(problems[name]).toEqual(
				[...new Set(uses.map((used) => functions[used].module))].map(
					(path) => `@directus/api/${path} could not be imported (ERR_MODULE_NOT_FOUND)`,
				),
			);
		}
	});
});

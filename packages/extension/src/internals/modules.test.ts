import { describe, expect, it } from 'vitest';
import { adapters } from './adapters.js';
import { checkInternals } from './check.js';
import { context, directus11 } from './fake-directus.js';
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

	// Outside Directus, @directus/api is not installed (V-141), as a Directus without any of the modules would be.
	it('fora de um Directus, o carregador de verdade não acha módulo nenhum, e a checagem recusa', async () => {
		const result = await checkInternals(adapters, load, context);
		const problems = result.status === 'refused' ? result.problems : {};

		expect(result.status).toBe('refused');

		for (const { name, uses } of adapters) {
			expect(problems[name]).toEqual(
				uses.map((used) => `@directus/api/${functions[used].module} could not be imported (ERR_MODULE_NOT_FOUND)`),
			);
		}
	});
});

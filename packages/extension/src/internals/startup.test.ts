import type { SchemaOverview } from '@directus/types';
import { describe, expect, it } from 'vitest';
import { adapters } from './adapters.js';
import type { Context } from './chain.js';
import { checkInternals } from './check.js';
import { database, directus11, directus12, type FakeModules, loaderOf } from './fake-directus.js';
import { checkOnStartup } from './startup.js';

const schema: SchemaOverview = { collections: {}, relations: [] };

const startWith = (modules: FakeModules, getSchema = () => Promise.resolve(schema)) => {
	const logs: [string, ...unknown[]][] = [];
	const checked: Context[] = [];
	const internals = checkOnStartup({
		getSchema,
		database,
		logger: {
			info: (...args: unknown[]) => logs.push(['info', ...args]),
			warn: (...args: unknown[]) => logs.push(['warn', ...args]),
			error: (...args: unknown[]) => logs.push(['error', ...args]),
		},
		check: (context) => {
			checked.push(context);

			return checkInternals(adapters, loaderOf(modules), context);
		},
	});

	return { internals, logs, checked };
};

describe('a checagem dos internos ao subir', () => {
	it('confere uma vez para o processo, e o log diz o adaptador', async () => {
		const { internals, logs, checked } = startWith(directus12());

		expect(await internals()).toEqual({ status: 'accepted', adapter: '12' });
		expect(await internals()).toEqual({ status: 'accepted', adapter: '12' });
		expect(checked).toHaveLength(1);
		expect(logs).toEqual([['info', { adapter: '12' }, 'The internals of Directus passed the adapter 12']]);
	});

	it('com os internos recusados, o log avisa, com o que falta', async () => {
		const modules = directus11();

		delete modules['database/run-ast/lib/get-db-query'];

		const { internals, logs } = startWith(modules);
		const result = await internals();

		expect(result).toMatchObject({ status: 'refused' });
		expect(logs).toEqual([
			[
				'warn',
				{ problems: 'problems' in result ? result.problems : {} },
				'No adapter of the extension takes the internals of this Directus, so the geospatial operations are off',
			],
		]);
	});

	it('quando o banco não entrega o schema, o log diz, e a próxima leitura confere de novo', async () => {
		const failure = new Error('connect ECONNREFUSED');
		let calls = 0;
		const { internals, logs } = startWith(directus12(), () => {
			calls += 1;

			return calls === 1 ? Promise.reject(failure) : Promise.resolve(schema);
		});

		await expect.poll(() => logs).toContainEqual(['error', failure, expect.stringContaining('checks again')]);
		expect(await internals()).toEqual({ status: 'accepted', adapter: '12' });
		expect(calls).toBe(2);
	});
});

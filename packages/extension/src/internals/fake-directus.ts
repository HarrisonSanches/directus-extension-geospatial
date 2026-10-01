import type { Permission } from '@directus/types';
import knex from 'knex';
import type { Load, ModulePath } from './modules.js';

// The fake loader of the unit tests: the modules of @directus/api as a table, in place of the running Directus, which
// the integration suite runs.

type Module = Record<string, unknown>;

export type FakeModules = Partial<Record<ModulePath, Module>>;

// A function that declares the number of parameters of the one of Directus it stands for, which the check reads.
export const withArity = <T extends (...args: never[]) => unknown>(arity: number, fn: T): T =>
	Object.defineProperty(fn, 'length', { value: arity });

// The dialect of the queries the tests build. Knex loads the driver of a client only to connect, and this one never
// does, so no builder of the tests runs.
const dialect = 'pg';

export const database = knex({ client: dialect });

export const context = { schema: { collections: {}, relations: [] }, knex: database };

export const permission: Permission = {
	id: 1,
	policy: 'operators',
	collection: 'occurrences',
	action: 'read',
	permissions: { region: { _eq: 'south' } },
	validation: null,
	presets: null,
	fields: ['*'],
};

// What the chain handed to getDBQuery, and whose policies it read.
export interface Received {
	getDBQuery: unknown[];
	fetchPolicies: unknown[];
}

// The modules of the chain as Directus 11.17 has them (V-146): each function with the arity of its source, and each
// step returning the shape Directus returns. getDBQuery builds the query of the table it gets.
export const directus11 = (received: Received = { getDBQuery: [], fetchPolicies: [] }): FakeModules => ({
	'database/get-ast-from-query/get-ast-from-query': {
		getAstFromQuery: withArity(2, (options: { collection: string }) =>
			Promise.resolve({
				type: 'root',
				name: options.collection,
				children: [{ type: 'field', name: 'collection' }],
				query: {},
				cases: [],
			}),
		),
	},
	'permissions/modules/process-ast/process-ast': {
		processAst: withArity(2, (options: { ast: unknown }) => Promise.resolve(options.ast)),
	},
	'database/run-ast/lib/parse-current-level': {
		parseCurrentLevel: withArity(4, (_schema: unknown, _collection: unknown, children: unknown[]) =>
			Promise.resolve({ fieldNodes: children, nestedCollectionNodes: [], primaryKeyField: 'collection' }),
		),
	},
	'permissions/lib/fetch-policies': {
		fetchPolicies: withArity(0, (accountability: unknown) => {
			received.fetchPolicies.push(accountability);

			return Promise.resolve([permission.policy]);
		}),
	},
	'permissions/lib/fetch-permissions': {
		fetchPermissions: withArity(2, () => Promise.resolve([permission])),
	},
	'database/run-ast/lib/get-db-query': {
		getDBQuery: withArity(2, (options: { table: string }) => {
			received.getDBQuery.push(options);

			return database.select('collection').from(options.table);
		}),
	},
});

// Directus 12 adds the module that refuses an inactive collection (V-146).
export const directus12 = (received?: Received): FakeModules => ({
	...directus11(received),
	'permissions/modules/assert-collection-active/assert-collection-active': {
		assertCollectionActive: withArity(2, () => Promise.resolve()),
	},
});

// A path out of the table fails as Node fails to import a file that does not exist.
export const loaderOf =
	(modules: FakeModules): Load =>
	(path) => {
		const module = modules[path];

		return module === undefined
			? Promise.reject(Object.assign(new Error(`Cannot find module '${path}'`), { code: 'ERR_MODULE_NOT_FOUND' }))
			: Promise.resolve(module);
	};

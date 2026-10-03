import type { Permission, Query } from '@directus/types';
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

type Filter = (query: Query, meta: Record<string, unknown>, context: unknown) => Query;

// The emitter of the core events, as Directus has it (api/src/emitter.ts): an instance, whose emitFilter calls the
// filters of each event in order, each one with what the one before returned, and declares 3 parameters, since the
// fourth has a default (V-174). The events go as a list, as the internals emit them.
export class FakeEmitter {
	private readonly filters = new Map<string, Filter[]>();

	// What each emit received, as it came.
	readonly emitted: { events: string[]; query: Query; meta: Record<string, unknown>; context: unknown }[] = [];

	filter(event: string, handler: Filter): void {
		this.filters.set(event, [...(this.filters.get(event) ?? []), handler]);
	}

	emitFilter(events: string[], query: Query, meta: Record<string, unknown>, context: unknown = null): Promise<Query> {
		let updated = query;

		this.emitted.push({ events, query: structuredClone(query), meta, context });

		for (const name of events) {
			for (const handler of this.filters.get(name) ?? []) {
				updated = handler(updated, { event: name, ...meta }, context);
			}
		}

		return Promise.resolve(updated);
	}
}

// What the chain handed to getAstFromQuery and to getDBQuery, and whose policies it read.
export interface Received {
	getAstFromQuery: unknown[];
	getDBQuery: unknown[];
	fetchPolicies: unknown[];
}

export const nothingReceived = (): Received => ({ getAstFromQuery: [], getDBQuery: [], fetchPolicies: [] });

// The modules of the chain as Directus 11.17 has them (V-146): each function with the arity of its source, and each
// step returning the shape Directus returns. getDBQuery builds the query of the table it gets.
export const directus11 = (received: Received = nothingReceived(), emitter = new FakeEmitter()): FakeModules => ({
	emitter: { default: emitter },
	'database/get-ast-from-query/get-ast-from-query': {
		getAstFromQuery: withArity(2, (options: { collection: string }) => {
			received.getAstFromQuery.push(options);

			return Promise.resolve({
				type: 'root',
				name: options.collection,
				children: [{ type: 'field', name: 'collection' }],
				query: {},
				cases: [],
			});
		}),
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
	// A query of the body comes back as it went, with the fields of a text split as Directus splits them.
	'utils/sanitize-query': {
		sanitizeQuery: withArity(3, (raw: Record<string, unknown>) =>
			Promise.resolve(typeof raw.fields === 'string' ? { ...raw, fields: raw.fields.split(',') } : raw),
		),
	},
	'utils/validate-query': {
		validateQuery: withArity(1, (query: Query) => query),
	},
});

// Directus 12 adds the module that refuses an inactive collection (V-146).
export const directus12 = (received?: Received, emitter?: FakeEmitter): FakeModules => ({
	...directus11(received, emitter),
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

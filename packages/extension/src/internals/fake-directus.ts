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

type Filter = (payload: unknown, meta: Record<string, unknown>, context: unknown) => unknown;

// The emitter of the core events, as Directus has it (api/src/emitter.ts): an instance, whose emitFilter calls the
// filters of each event in order, each one with what the one before returned, and declares 3 parameters, since the
// fourth has a default, and whose emitAction declares 2, for the same reason (V-174). The events go as a list, as the
// internals emit them.
export class FakeEmitter {
	private readonly filters = new Map<string, Filter[]>();

	// What each emitFilter received, as it came.
	readonly emitted: { events: string[]; payload: unknown; meta: Record<string, unknown>; context: unknown }[] = [];

	// What each emitAction received.
	readonly acted: { events: string[]; meta: Record<string, unknown>; context: unknown }[] = [];

	// The filters and the actions, in the order they were emitted.
	readonly order: ('filter' | 'action')[] = [];

	// A filter of a hook, on the payload of the type its event carries: the query of items.query, the items of items.read.
	filter<T>(event: string, handler: (payload: T, meta: Record<string, unknown>, context: unknown) => T): void {
		const filter: Filter = (payload, meta, context) => handler(payload as T, meta, context);

		this.filters.set(event, [...(this.filters.get(event) ?? []), filter]);
	}

	emitFilter<T>(events: string[], payload: T, meta: Record<string, unknown>, context: unknown = null): Promise<T> {
		let updated: unknown = payload;

		this.emitted.push({ events, payload: structuredClone(payload), meta, context });
		this.order.push('filter');

		for (const name of events) {
			for (const handler of this.filters.get(name) ?? []) {
				updated = handler(updated, { event: name, ...meta }, context);
			}
		}

		return Promise.resolve(updated as T);
	}

	emitAction(events: string[], meta: Record<string, unknown>, context: unknown = null): void {
		this.acted.push({ events, meta, context });
		this.order.push('action');
	}
}

// What the chain handed to each step of Directus, and whose policies it read.
export interface Received {
	getAstFromQuery: unknown[];
	processAst: unknown[];
	getDBQuery: unknown[];
	fetchPolicies: unknown[];
	fetchPermissions: unknown[];
	assertCollectionActive: unknown[];
}

export const nothingReceived = (): Received => ({
	getAstFromQuery: [],
	processAst: [],
	getDBQuery: [],
	fetchPolicies: [],
	fetchPermissions: [],
	assertCollectionActive: [],
});

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
				children: [{ type: 'field', name: 'collection', fieldKey: 'collection' }],
				query: {},
				cases: [],
			});
		}),
	},
	'permissions/modules/process-ast/process-ast': {
		processAst: withArity(2, (options: { ast: unknown }) => {
			received.processAst.push(options);

			return Promise.resolve(options.ast);
		}),
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
		fetchPermissions: withArity(2, (options: unknown) => {
			received.fetchPermissions.push(options);

			return Promise.resolve([permission]);
		}),
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
export const directus12 = (received: Received = nothingReceived(), emitter?: FakeEmitter): FakeModules => ({
	...directus11(received, emitter),
	'permissions/modules/assert-collection-active/assert-collection-active': {
		assertCollectionActive: withArity(2, (options: unknown) => {
			received.assertCollectionActive.push(options);

			return Promise.resolve();
		}),
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

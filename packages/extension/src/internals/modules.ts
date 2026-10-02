// The modules of @directus/api the adapters read, by their path in the package (V-23), as directus-api.d.ts declares
// them.
interface Modules {
	'database/get-ast-from-query/get-ast-from-query': typeof import('@directus/api/database/get-ast-from-query/get-ast-from-query');
	'permissions/modules/process-ast/process-ast': typeof import('@directus/api/permissions/modules/process-ast/process-ast');
	'database/run-ast/lib/parse-current-level': typeof import('@directus/api/database/run-ast/lib/parse-current-level');
	'permissions/lib/fetch-policies': typeof import('@directus/api/permissions/lib/fetch-policies');
	'permissions/lib/fetch-permissions': typeof import('@directus/api/permissions/lib/fetch-permissions');
	'database/run-ast/lib/get-db-query': typeof import('@directus/api/database/run-ast/lib/get-db-query');
	'permissions/modules/assert-collection-active/assert-collection-active': typeof import('@directus/api/permissions/modules/assert-collection-active/assert-collection-active');
	emitter: typeof import('@directus/api/emitter');
}

export type ModulePath = keyof Modules;

// Each function the adapters call, with the module that exports it and the number of parameters it declares, the same
// in 11.17 and in 12 (V-146). Directus wraps fetchPolicies in a cache, which declares none. The emitFilter is a method
// of the emitter the module exports by default, whose fourth parameter has a default value, which Function.length does
// not count (V-174).
export const functions = {
	getAstFromQuery: { module: 'database/get-ast-from-query/get-ast-from-query', arity: 2 },
	processAst: { module: 'permissions/modules/process-ast/process-ast', arity: 2 },
	parseCurrentLevel: { module: 'database/run-ast/lib/parse-current-level', arity: 4 },
	fetchPolicies: { module: 'permissions/lib/fetch-policies', arity: 0 },
	fetchPermissions: { module: 'permissions/lib/fetch-permissions', arity: 2 },
	getDBQuery: { module: 'database/run-ast/lib/get-db-query', arity: 2 },
	assertCollectionActive: {
		module: 'permissions/modules/assert-collection-active/assert-collection-active',
		arity: 2,
	},
	emitFilter: { module: 'emitter', arity: 3, owner: 'default' },
} as const satisfies Record<string, { module: ModulePath; arity: number; owner?: 'default' }>;

export type FunctionName = keyof typeof functions;

type Entry<F extends FunctionName> = (typeof functions)[F];

// The object a function of the table is a property of: the module, or the object it exports by default.
type OwnerOf<F extends FunctionName> =
	Entry<F> extends { owner: 'default' }
		? Modules[Entry<F>['module']] extends { default: infer D }
			? D
			: never
		: Modules[Entry<F>['module']];

type FunctionOf<F extends FunctionName> = F extends keyof OwnerOf<F> ? OwnerOf<F>[F] : never;

// The internals of the running Directus are not the ones an adapter expects: a function or the shape of what a step
// returns.
export class InternalsMismatchError extends Error {}

// Whether a value is the function an adapter expects: the check sees that it is a function and how many parameters it
// declares, and takes the rest of its type from the declarations, which the parity with /items confirms (V-146).
const isFunctionOf = <F extends FunctionName>(value: unknown, name: F): value is FunctionOf<F> =>
	typeof value === 'function' && value.length === functions[name].arity;

// A function of the running Directus, which the check found with the arity the adapter expects.
export type Take = <F extends FunctionName>(name: F) => FunctionOf<F>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The object of a loaded module a function of the table is a property of: the module itself, or its default export.
export const ownerOf = (module: unknown, name: FunctionName): unknown => {
	return 'owner' in functions[name] && isRecord(module) ? module.default : module;
};

// The functions of the modules the check loaded, by name. Each one runs with the object it is a property of as this, as
// Directus calls the method of its emitter, and binding keeps the number of parameters it declares.
export const takeFrom =
	(modules: ReadonlyMap<string, unknown>): Take =>
	(name) => {
		const owner = ownerOf(modules.get(functions[name].module), name);
		const found = isRecord(owner) ? owner[name] : undefined;
		const value: unknown = typeof found === 'function' ? found.bind(owner) : found;

		if (!isFunctionOf(value, name)) {
			throw new InternalsMismatchError(`The running Directus has no ${name} with the arity the adapter expects.`);
		}

		return value;
	};

// A module of the running Directus, or the error of its import, such as ERR_MODULE_NOT_FOUND when it does not exist.
// It is unknown until the check looks at it: the declarations describe the versions they were written for, and not the
// Directus that runs.
export type Load = (path: ModulePath) => Promise<unknown>;

// Each import names its module, so the build keeps it as an import of the running Directus (extension.config.js), and
// none runs before the check asks for it. A static import of a module a version lacks would stop the whole extension
// from loading, before the check could say what is missing (V-146).
const imports: Record<ModulePath, () => Promise<unknown>> = {
	'database/get-ast-from-query/get-ast-from-query': () =>
		import('@directus/api/database/get-ast-from-query/get-ast-from-query'),
	'permissions/modules/process-ast/process-ast': () =>
		import('@directus/api/permissions/modules/process-ast/process-ast'),
	'database/run-ast/lib/parse-current-level': () => import('@directus/api/database/run-ast/lib/parse-current-level'),
	'permissions/lib/fetch-policies': () => import('@directus/api/permissions/lib/fetch-policies'),
	'permissions/lib/fetch-permissions': () => import('@directus/api/permissions/lib/fetch-permissions'),
	'database/run-ast/lib/get-db-query': () => import('@directus/api/database/run-ast/lib/get-db-query'),
	'permissions/modules/assert-collection-active/assert-collection-active': () =>
		import('@directus/api/permissions/modules/assert-collection-active/assert-collection-active'),
	emitter: () => import('@directus/api/emitter'),
};

export const load: Load = (path) => imports[path]();

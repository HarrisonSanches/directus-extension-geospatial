import type { Accountability } from '@directus/types';
import type { Context } from './permitted-query.js';

// What an adapter needs from the running Directus: a function that a module of @directus/api exports, with the number
// of parameters it declares, or a module that the Directus it was written for does not have, and why that matters.
export type Expectation = { module: string; function: string; arity: number } | { module: string; absent: string };

export interface Adapter {
	name: string;
	expects: readonly Expectation[];
	// What the ItemsService of that Directus does before the hooks of items.query.
	beforeHooks: (
		request: { collection: string; accountability: Accountability | null },
		context: Context,
	) => Promise<void>;
}

// The functions of the chain, with the same exports and arities in 11.17 and 12. Directus wraps fetchPolicies in a
// cache, so it declares no parameter.
const chain: readonly Expectation[] = [
	{ module: 'database/get-ast-from-query/get-ast-from-query', function: 'getAstFromQuery', arity: 2 },
	{ module: 'permissions/modules/process-ast/process-ast', function: 'processAst', arity: 2 },
	{ module: 'database/run-ast/lib/parse-current-level', function: 'parseCurrentLevel', arity: 4 },
	{ module: 'permissions/lib/fetch-policies', function: 'fetchPolicies', arity: 0 },
	{ module: 'permissions/lib/fetch-permissions', function: 'fetchPermissions', arity: 2 },
	{ module: 'database/run-ast/lib/get-db-query', function: 'getDBQuery', arity: 2 },
];

const assertCollectionActive = 'permissions/modules/assert-collection-active/assert-collection-active';

// Directus 11.17, which has no inactive collections. A Directus that has them refuses one before the hooks, and this
// adapter would run the hooks first, so it refuses that Directus.
const v11: Adapter = {
	name: '11.17',
	expects: [
		...chain,
		{
			module: assertCollectionActive,
			absent: 'this Directus refuses an inactive collection before the hooks, which this adapter does not',
		},
	],
	beforeHooks: () => Promise.resolve(),
};

// Directus 12, whose readByQuery refuses an inactive collection before the hooks.
const v12: Adapter = {
	name: '12',
	expects: [...chain, { module: assertCollectionActive, function: 'assertCollectionActive', arity: 2 }],
	beforeHooks: async ({ collection, accountability }, context) => {
		const { assertCollectionActive } =
			await import('@directus/api/permissions/modules/assert-collection-active/assert-collection-active');

		await assertCollectionActive({ accountability, collection, action: 'read' }, context);
	},
};

// An adapter for no Directus, with a signature and a function that no version has, which the check refuses on both.
const broken: Adapter = {
	name: 'broken',
	expects: [
		...chain.map((expectation) =>
			'function' in expectation && expectation.function === 'getDBQuery' ? { ...expectation, arity: 3 } : expectation,
		),
		{ module: 'database/run-ast/lib/get-db-query', function: 'getPermittedQuery', arity: 2 },
	],
	beforeHooks: () => Promise.resolve(),
};

export const adapters: Readonly<Record<string, Adapter>> = { '11.17': v11, '12': v12, broken };

// The adapters of real versions, the newest first. The radius takes the first that the running Directus passes.
export const candidates: readonly Adapter[] = [v12, v11];

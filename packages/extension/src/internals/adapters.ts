import type { InternalsAccepted } from 'directus-geospatial-contract';
import type { Context, Request } from './chain.js';
import { type FunctionName, functions, type ModulePath, type Take } from './modules.js';

export interface Adapter {
	// Named after the Directus version it was written for.
	name: InternalsAccepted['adapter'];
	// The functions of @directus/api it calls.
	uses: readonly FunctionName[];
	// The modules the Directus it was written for does not have, and why one that has them is not that Directus.
	lacks: readonly { module: ModulePath; because: string }[];
	// What the readByQuery of that Directus does before the hooks of items.query, which then change the query, and the
	// chain builds the permitted query of what they returned (V-142, V-144).
	beforeHooks: (take: Take, request: Request, context: Context) => Promise<void>;
}

// The steps of the readByQuery the same in 11.17 and in 12: the hooks of items.query, and the chain up to getDBQuery.
const readFunctions = [
	'emitFilter',
	'getAstFromQuery',
	'processAst',
	'parseCurrentLevel',
	'fetchPolicies',
	'fetchPermissions',
	'getDBQuery',
] as const;

// How Directus reads the query of /items from the body of a SEARCH, the same in 11.17 and in 12
// (api/src/middleware/validate-batch.ts, V-181).
const pageFunctions = ['sanitizeQuery', 'validateQuery'] as const;

// Directus 11.17, which has no inactive collections. A Directus that has them refuses one before the hooks, which this
// adapter would run first, so it refuses that Directus (V-146).
const v11: Adapter = {
	name: '11.17',
	uses: [...readFunctions, ...pageFunctions],
	lacks: [
		{
			module: functions.assertCollectionActive.module,
			because:
				'this Directus refuses an inactive collection before the hooks of items.query, which this adapter does not',
		},
	],
	beforeHooks: () => Promise.resolve(),
};

// Directus 12, whose readByQuery refuses an inactive collection before the hooks of items.query (V-142).
const v12: Adapter = {
	name: '12',
	uses: [...readFunctions, ...pageFunctions, 'assertCollectionActive'],
	lacks: [],
	beforeHooks: async (take, { collection, accountability }, context) => {
		await take('assertCollectionActive')({ accountability, collection, action: 'read' }, context);
	},
};

// The newest first: the check takes the first one the running Directus passes.
export const adapters: readonly Adapter[] = [v12, v11];

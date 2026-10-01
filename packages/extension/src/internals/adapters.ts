import type { InternalsAccepted } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import { chain, type Context, type Request } from './chain.js';
import { type FunctionName, functions, type ModulePath, type Take } from './modules.js';

export interface Adapter {
	// Named after the Directus version it was written for.
	name: InternalsAccepted['adapter'];
	// The functions of @directus/api it calls.
	uses: readonly FunctionName[];
	// The modules the Directus it was written for does not have, and why one that has them is not that Directus.
	lacks: readonly { module: ModulePath; because: string }[];
	// The query of what the accountability can read, built as the readByQuery of that Directus builds it.
	permittedQuery: (take: Take, request: Request, context: Context) => Promise<{ builder: Knex.QueryBuilder }>;
}

const chainFunctions = [
	'getAstFromQuery',
	'processAst',
	'parseCurrentLevel',
	'fetchPolicies',
	'fetchPermissions',
	'getDBQuery',
] as const;

// Directus 11.17, which has no inactive collections. A Directus that has them refuses one before the hooks, which this
// adapter would run first, so it refuses that Directus (V-146).
const v11: Adapter = {
	name: '11.17',
	uses: chainFunctions,
	lacks: [
		{
			module: functions.assertCollectionActive.module,
			because:
				'this Directus refuses an inactive collection before the hooks of items.query, which this adapter does not',
		},
	],
	permittedQuery: chain,
};

// Directus 12, whose readByQuery refuses an inactive collection before the hooks of items.query (V-142).
const v12: Adapter = {
	name: '12',
	uses: [...chainFunctions, 'assertCollectionActive'],
	lacks: [],
	permittedQuery: async (take, request, context) => {
		const { collection, accountability } = request;

		await take('assertCollectionActive')({ accountability, collection, action: 'read' }, context);

		return chain(take, request, context);
	},
};

// The newest first: the check takes the first one the running Directus passes.
export const adapters: readonly Adapter[] = [v12, v11];

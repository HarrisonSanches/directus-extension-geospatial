import { getAstFromQuery } from '@directus/api/database/get-ast-from-query/get-ast-from-query';
import { getDBQuery } from '@directus/api/database/run-ast/lib/get-db-query';
import { parseCurrentLevel } from '@directus/api/database/run-ast/lib/parse-current-level';
import { fetchPermissions } from '@directus/api/permissions/lib/fetch-permissions';
import { fetchPolicies } from '@directus/api/permissions/lib/fetch-policies';
import { processAst } from '@directus/api/permissions/modules/process-ast/process-ast';
import type { Accountability, ApiExtensionContext, Permission, Query, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';

interface Request {
	collection: string;
	query: Query;
	accountability: Accountability | null;
}

interface Context {
	schema: SchemaOverview;
	knex: ApiExtensionContext['database'];
}

// The query of what the accountability can read in a collection, built by the chain the ItemsService of Directus reads
// with (readByQuery, in api/src/services/items.ts, and run, in api/src/database/run-ast/run-ast.ts), up to the
// getDBQuery, which returns the builder without running it (V-21). The spikes read one level, with no relations.
//
// The builder goes back inside an object. It has a then of its own, so a promise that resolved to it would take it as
// a promise and run the query.
export const permittedQuery = async (
	{ collection, query, accountability }: Request,
	context: Context,
): Promise<{ builder: Knex.QueryBuilder }> => {
	// processAst refuses a field the accountability cannot read, and injects the rules of each policy as cases.
	const ast = await processAst(
		{ ast: await getAstFromQuery({ collection, query, accountability }, context), action: 'read', accountability },
		context,
	);

	const { fieldNodes, nestedCollectionNodes } = await parseCurrentLevel(
		context.schema,
		ast.name,
		ast.children,
		ast.query,
	);

	// The admin reads with no permission at all, and so with no filter.
	let permissions: Permission[] = [];

	if (accountability !== null && !accountability.admin) {
		const policies = await fetchPolicies(accountability, context);

		permissions = await fetchPermissions({ action: 'read', accountability, policies }, context);
	}

	const builder = getDBQuery(
		{
			table: ast.name,
			fieldNodes,
			o2mNodes: nestedCollectionNodes.filter(({ type }) => type === 'o2m'),
			query: ast.query,
			cases: ast.cases,
			permissions,
		},
		context,
	);

	return { builder };
};

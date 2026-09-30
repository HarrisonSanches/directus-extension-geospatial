import type { fetchPermissions as FetchPermissions } from '@directus/api/permissions/lib/fetch-permissions';
import type { Accountability, ApiExtensionContext, Permission, Query, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';

interface Request {
	collection: string;
	query: Query;
	accountability: Accountability | null;
}

export interface Context {
	schema: SchemaOverview;
	knex: ApiExtensionContext['database'];
}

// The chain comes from the running Directus when it runs, and not when the extension loads. A static import of a
// module or a function that a version lacks would stop the whole extension from loading, before the check of the
// adapter could say what is missing (F01-06).
const chain = async () => {
	const [
		{ getAstFromQuery },
		{ processAst },
		{ parseCurrentLevel },
		{ fetchPolicies },
		{ fetchPermissions },
		{ getDBQuery },
	] = await Promise.all([
		import('@directus/api/database/get-ast-from-query/get-ast-from-query'),
		import('@directus/api/permissions/modules/process-ast/process-ast'),
		import('@directus/api/database/run-ast/lib/parse-current-level'),
		import('@directus/api/permissions/lib/fetch-policies'),
		import('@directus/api/permissions/lib/fetch-permissions'),
		import('@directus/api/database/run-ast/lib/get-db-query'),
	]);

	return { getAstFromQuery, processAst, parseCurrentLevel, fetchPolicies, fetchPermissions, getDBQuery };
};

// Whether a read rule of the policies uses $NOW, which Directus turns into the time of each request, so the values of
// the permitted query change every time (V-55). The rules as the policies store them, before Directus resolves them.
const usesNow = async (
	fetchPermissions: typeof FetchPermissions,
	policies: string[],
	accountability: Accountability,
	context: Context,
) => {
	const rules = await fetchPermissions(
		{ action: 'read', accountability, policies, bypassDynamicVariableProcessing: true },
		context,
	);

	return rules.some(({ permissions }) => JSON.stringify(permissions ?? {}).includes('$NOW'));
};

// The query of what the accountability can read in a collection, built by the chain the ItemsService of Directus reads
// with (readByQuery, in api/src/services/items.ts, and run, in api/src/database/run-ast/run-ast.ts), up to the
// getDBQuery, which returns the builder without running it (V-21). The spikes read one level, with no relations.
//
// The builder goes back inside an object. It has a then of its own, so a promise that resolved to it would take it as
// a promise and run the query.
export const permittedQuery = async (
	{ collection, query, accountability }: Request,
	context: Context,
): Promise<{ builder: Knex.QueryBuilder; usesNow: boolean }> => {
	const { getAstFromQuery, processAst, parseCurrentLevel, fetchPolicies, fetchPermissions, getDBQuery } = await chain();

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
	let now = false;

	if (accountability !== null && !accountability.admin) {
		const policies = await fetchPolicies(accountability, context);

		permissions = await fetchPermissions({ action: 'read', accountability, policies }, context);
		now = await usesNow(fetchPermissions, policies, accountability, context);
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

	return { builder, usesNow: now };
};

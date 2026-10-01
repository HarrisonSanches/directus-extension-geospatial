import type { AST, Node } from '@directus/api/types/ast';
import type { Accountability, ApiExtensionContext, Permission, Query, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { InternalsMismatchError, type Take } from './modules.js';

export interface Request {
	collection: string;
	query: Query;
	accountability: Accountability | null;
}

export interface Context {
	schema: SchemaOverview;
	knex: ApiExtensionContext['database'];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isNode = (value: unknown): value is Node => isRecord(value) && typeof value.type === 'string';

const isTree = (value: unknown): value is AST =>
	isRecord(value) &&
	value.type === 'root' &&
	typeof value.name === 'string' &&
	Array.isArray(value.children) &&
	value.children.every(isNode) &&
	isRecord(value.query) &&
	Array.isArray(value.cases);

const isLevel = (value: unknown): value is { fieldNodes: Node[]; nestedCollectionNodes: Node[] } =>
	isRecord(value) &&
	Array.isArray(value.fieldNodes) &&
	value.fieldNodes.every(isNode) &&
	Array.isArray(value.nestedCollectionNodes) &&
	value.nestedCollectionNodes.every(isNode);

const isBuilder = (value: unknown): value is Knex.QueryBuilder => isRecord(value) && typeof value.toSQL === 'function';

// What a step of the chain returned, in the shape the adapter reads it by, which the check sees by building the chain
// (V-146), and every query checks again.
const shaped = <T>(value: unknown, isShape: (value: unknown) => value is T, step: string, shape: string): T => {
	if (!isShape(value)) {
		throw new InternalsMismatchError(`${step} returned something other than ${shape}.`);
	}

	return value;
};

// The query of what the accountability can read in a collection, built by the chain the ItemsService of Directus reads
// with (readByQuery, in api/src/services/items.ts, and run, in api/src/database/run-ast/run-ast.ts), up to the
// getDBQuery, which returns the builder without running it (V-21, V-142). One level, with no relations.
//
// The builder goes back inside an object. It has a then of its own, so a promise that resolved to it would take it as
// a promise and run the query (V-142).
export const chain = async (
	take: Take,
	{ collection, query, accountability }: Request,
	context: Context,
): Promise<{ builder: Knex.QueryBuilder }> => {
	const tree = shaped(
		await take('getAstFromQuery')({ collection, query, accountability }, context),
		isTree,
		'getAstFromQuery',
		'a tree of fields',
	);

	// processAst refuses a field the accountability cannot read, and injects the rules of each policy as cases.
	const ast = shaped(
		await take('processAst')({ ast: tree, action: 'read', accountability }, context),
		isTree,
		'processAst',
		'a tree of fields',
	);

	const { fieldNodes, nestedCollectionNodes } = shaped(
		await take('parseCurrentLevel')(context.schema, ast.name, ast.children, ast.query),
		isLevel,
		'parseCurrentLevel',
		'the nodes of a level',
	);

	// The admin, and Directus reading for itself, read with no permission at all, and so with no filter.
	let permissions: Permission[] = [];

	if (accountability !== null && !accountability.admin) {
		const policies = await take('fetchPolicies')(accountability, context);

		permissions = await take('fetchPermissions')({ action: 'read', accountability, policies }, context);
	}

	const builder = shaped(
		take('getDBQuery')(
			{
				table: ast.name,
				fieldNodes,
				o2mNodes: nestedCollectionNodes.filter(({ type }) => type === 'o2m'),
				query: ast.query,
				cases: ast.cases,
				permissions,
			},
			context,
		),
		isBuilder,
		'getDBQuery',
		'a query builder',
	);

	return { builder };
};

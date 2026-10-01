// The internals of Directus the adapters use, declared here instead of installing @directus/api: the running Directus
// provides the code (V-141), and the package would bring its whole dependency tree into the lockfile, and into the
// bundle. Each declaration matches the source of the tags v11.17.4 and v12.4.1. The package maps each path to
// dist/<path>.js (V-23), so the specifiers have no extension. What a declaration says beyond the module, the function
// and its arity, the check cannot confirm (V-146), and the parity with /items does.

// The tree of fields Directus reads a collection by (api/src/types/ast.ts). The extension only looks at the root and at
// the type of each node, and hands the rest back to Directus as it came.
declare module '@directus/api/types/ast' {
	import type { Filter, Query } from '@directus/types';

	export interface Node {
		type: string;
	}

	export interface AST {
		type: 'root';
		name: string;
		children: Node[];
		query: Query;
		// The rules of each policy, which the read permissions point to by their position.
		cases: Filter[];
	}
}

declare module '@directus/api/database/get-ast-from-query/get-ast-from-query' {
	import type { AST } from '@directus/api/types/ast';
	import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';

	export function getAstFromQuery(
		options: { collection: string; query: Query; accountability: Accountability | null },
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<AST>;
}

declare module '@directus/api/permissions/modules/process-ast/process-ast' {
	import type { AST } from '@directus/api/types/ast';
	import type { Accountability, ApiExtensionContext, PermissionsAction, SchemaOverview } from '@directus/types';

	export function processAst(
		options: { ast: AST; action: PermissionsAction; accountability: Accountability | null },
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<AST>;
}

declare module '@directus/api/database/run-ast/lib/parse-current-level' {
	import type { Node } from '@directus/api/types/ast';
	import type { Query, SchemaOverview } from '@directus/types';

	export function parseCurrentLevel(
		schema: SchemaOverview,
		collection: string,
		children: Node[],
		query: Query,
	): Promise<{ fieldNodes: Node[]; nestedCollectionNodes: Node[]; primaryKeyField: string }>;
}

declare module '@directus/api/permissions/lib/fetch-policies' {
	import type { Accountability, ApiExtensionContext, SchemaOverview } from '@directus/types';

	export function fetchPolicies(
		accountability: Pick<Accountability, 'user' | 'roles' | 'ip'>,
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<string[]>;
}

declare module '@directus/api/permissions/lib/fetch-permissions' {
	import type {
		Accountability,
		ApiExtensionContext,
		Permission,
		PermissionsAction,
		SchemaOverview,
	} from '@directus/types';

	export function fetchPermissions(
		options: {
			action?: PermissionsAction;
			policies: string[];
			collections?: string[];
			accountability?: Pick<Accountability, 'user' | 'role' | 'roles' | 'app' | 'share' | 'ip'>;
		},
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<Permission[]>;
}

// Builds the query of one level of the tree, without running it (V-21).
declare module '@directus/api/database/run-ast/lib/get-db-query' {
	import type { Node } from '@directus/api/types/ast';
	import type { ApiExtensionContext, Filter, Permission, Query, SchemaOverview } from '@directus/types';
	import type { Knex } from 'knex';

	export function getDBQuery(
		options: {
			table: string;
			fieldNodes: Node[];
			o2mNodes: Node[];
			query: Query;
			cases: Filter[];
			permissions: Permission[];
		},
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Knex.QueryBuilder;
}

// Directus 12 only: refuses a collection that is not active, which the readByQuery of the ItemsService asserts before
// the hooks of items.query. Directus 11.17 has no such module (V-146).
declare module '@directus/api/permissions/modules/assert-collection-active/assert-collection-active' {
	import type { Accountability, ApiExtensionContext, PermissionsAction, SchemaOverview } from '@directus/types';

	export function assertCollectionActive(
		options: { accountability: Accountability | null; collection: string; action: PermissionsAction },
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<void>;
}

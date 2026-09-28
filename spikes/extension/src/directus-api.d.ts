// The internals of Directus the spikes use, declared here instead of installing @directus/api: the running Directus
// provides the code, and the package would bring its whole dependency tree into the lockfile. Each declaration
// matches the source of the tags v11.17.4 and v12.4.1, and the spikes prove it against both at runtime. The package
// maps each path to dist/<path>.js (V-23), so the specifiers have no extension.

declare module '@directus/api/database/index' {
	import type { ApiExtensionContext } from '@directus/types';

	export function getDatabase(): ApiExtensionContext['database'];
}

declare module '@directus/api/services/items' {
	import type { ExtensionsServices } from '@directus/types';

	export const ItemsService: ExtensionsServices['ItemsService'];
}

declare module '@directus/api/utils/get-schema' {
	import type { ApiExtensionContext } from '@directus/types';

	export const getSchema: ApiExtensionContext['getSchema'];
}

// The emitter of the core events, where the filter of each hook registers (api/src/emitter.ts). The emitter in the
// context of an extension is another one, only for events between extensions.
declare module '@directus/api/emitter' {
	import type { EventContext } from '@directus/types';

	const emitter: {
		emitFilter<T>(
			event: string | string[],
			payload: T,
			meta: Record<string, unknown>,
			context?: EventContext | null,
		): Promise<T>;
	};

	export default emitter;
}

// The tree of fields Directus reads a collection by (api/src/types/ast.ts). The spikes only look at the root and at
// the type of each node, and hand the rest back to Directus as it came.
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
			// The rules as the policies store them, with the dynamic variables, such as $NOW, left as they are.
			bypassDynamicVariableProcessing?: boolean;
		},
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<Permission[]>;
}

// Directus 12 only: refuses a collection that is not active, which the readByQuery of the ItemsService asserts before
// the hooks. Directus 11.17 has no such module (F01-06).
declare module '@directus/api/permissions/modules/assert-collection-active/assert-collection-active' {
	import type { Accountability, ApiExtensionContext, PermissionsAction, SchemaOverview } from '@directus/types';

	export function assertCollectionActive(
		options: { accountability: Accountability | null; collection: string; action: PermissionsAction },
		context: { schema: SchemaOverview; knex: ApiExtensionContext['database'] },
	): Promise<void>;
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

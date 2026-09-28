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

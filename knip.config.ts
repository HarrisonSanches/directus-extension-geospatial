import type { KnipConfig } from 'knip';
import extension from './packages/extension/package.json' with { type: 'json' };

// The extension starts at the sources of the bundle in its Directus manifest, which Knip does not read by itself.
export default {
	workspaces: {
		'packages/extension': { entry: extension['directus:extension'].entries.map(({ source }) => source) },
	},
} satisfies KnipConfig;

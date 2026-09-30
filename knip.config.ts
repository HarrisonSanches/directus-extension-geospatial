import type { KnipConfig } from 'knip';
import extension from './packages/extension/package.json' with { type: 'json' };

// Each extension starts at the sources of the bundle in its Directus manifest, which Knip does not read by itself.
const entriesOf = (manifest: typeof extension) => manifest['directus:extension'].entries.map(({ source }) => source);

export default {
	workspaces: {
		// Node runs the preload inside the image of Directus with SpatiaLite, whose Dockerfile Knip does not read.
		'.': { entry: ['test/spatialite/load-spatialite.ts'] },
		'packages/extension': { entry: entriesOf(extension) },
	},
} satisfies KnipConfig;

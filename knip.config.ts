import type { KnipConfig } from 'knip';
import extension from './packages/extension/package.json' with { type: 'json' };
import spikes from './spikes/extension/package.json' with { type: 'json' };
import hook from './spikes/hook/package.json' with { type: 'json' };

// Each extension starts at the sources of the bundle in its Directus manifest, which Knip does not read by itself.
const entriesOf = (manifest: typeof extension | typeof spikes | typeof hook) =>
	manifest['directus:extension'].entries.map(({ source }) => source);

export default {
	workspaces: {
		// Node runs the preload inside the image of Directus with SpatiaLite, whose Dockerfile Knip does not read.
		'.': { entry: ['test/spatialite/load-spatialite.ts'] },
		'packages/extension': { entry: entriesOf(extension) },
		// The extensions SDK loads its configuration by name, and the running Directus provides @directus/api, which the
		// spikes declare instead of installing.
		'spikes/extension': {
			entry: [...entriesOf(spikes), 'extension.config.js'],
			ignoreDependencies: ['@directus/api'],
		},
		'spikes/hook': { entry: entriesOf(hook) },
	},
} satisfies KnipConfig;

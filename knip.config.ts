import type { KnipConfig } from 'knip';
import extension from './packages/extension/package.json' with { type: 'json' };
import testHook from './test/hook/package.json' with { type: 'json' };
import observer from './test/measure/observer/package.json' with { type: 'json' };

// Each extension starts at the sources of the bundle in its Directus manifest, which Knip does not read by itself.
const entriesOf = (manifest: { 'directus:extension': { entries: { source: string }[] } }) =>
	manifest['directus:extension'].entries.map(({ source }) => source);

export default {
	workspaces: {
		// Node runs the preload inside the image of Directus with SpatiaLite, whose Dockerfile Knip does not read.
		'.': { entry: ['test/spatialite/load-spatialite.ts'] },
		'packages/extension': {
			// The extensions SDK reads extension.config.js when it builds.
			entry: [...entriesOf(extension), 'extension.config.js'],
			// The running Directus provides @directus/api, which internals/directus-api.d.ts declares and nothing installs
			// (V-141).
			ignoreDependencies: ['@directus/api'],
		},
		'test/hook': { entry: entriesOf(testHook) },
		'test/measure/observer': { entry: entriesOf(observer) },
	},
} satisfies KnipConfig;

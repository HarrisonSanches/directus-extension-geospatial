import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// The folder of the package a file inside node_modules belongs to, with its scope.
/** @param {string} file */
const packageOf = (file) => {
	const start = file.lastIndexOf('/node_modules/') + '/node_modules/'.length;
	const parts = file.slice(start).split('/');

	return file.slice(0, start) + parts.slice(0, parts[0]?.startsWith('@') ? 2 : 1).join('/');
};

// The module a false in the browser field of a package stands for.
const empty = '\0browser-field-empty';

// The build of the extensions SDK writes one file, with every dynamic import inlined (V-08). The plugin below keeps the
// rest of that build and asks Rollup for a folder instead, so each dynamic import becomes a chunk of its own beside
// the entry, which the API of Directus bundles again into the chunks of /extensions/sources (P-01). With
// SPIKE_LAYOUT_INLINE=1, the build stays the one of the SDK, for the proof to weigh both. The SDK reads this file only
// as JavaScript.
const keepDynamicImports = {
	name: 'keep-dynamic-imports',
	/** @param {{ file?: string, dir?: string, entryFileNames?: unknown }} options */
	outputOptions: ({ file, ...options }) => ({
		...options,
		inlineDynamicImports: false,
		dir: file === undefined ? options.dir : file.slice(0, file.lastIndexOf('/')),
		entryFileNames: file === undefined ? options.entryFileNames : file.slice(file.lastIndexOf('/') + 1),
		chunkFileNames: 'chunks/[name]-[hash].js',
	}),
};

// MapLibre 6 starts its worker from a module beside its own, which imports a module it shares with the page. The API
// serves only the chunks it bundles, so the build of the app copies both files next to the bundle, as MapLibre
// publishes them, in a folder named after the version, and the route of the bundle serves them (F01-14).
const maplibreWorker = {
	name: 'maplibre-worker',
	/**
	 * @this {{ emitFile: (file: { type: 'asset', fileName: string, source: Buffer }) => string }}
	 * @param {unknown} _
	 * @param {Record<string, { type: string, isEntry?: boolean, fileName: string }>} bundle
	 */
	async generateBundle(_, bundle) {
		if (!Object.values(bundle).some((file) => file.type === 'chunk' && file.isEntry && file.fileName === 'app.js')) {
			return;
		}

		const dist = dirname(fileURLToPath(import.meta.resolve('maplibre-gl')));
		/** @type {{ version: string }} */
		const { version } = JSON.parse(await readFile(join(dist, '..', 'package.json'), 'utf8'));

		for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
			this.emitFile({
				type: 'asset',
				fileName: `maplibre-gl/${version}/${file}`,
				source: await readFile(join(dist, file)),
			});
		}
	},
};

export default {
	plugins: [
		...(process.env.SPIKE_LAYOUT_INLINE === '1' ? [] : [keepDynamicImports]),
		maplibreWorker,
		{
			// The browser field of a package swaps a file of Node for one of the browser, as loaders.gl does with worker_threads.
			// The esbuild plugin of the SDK resolves every relative import to its file before the resolution of Node reads
			// that field, so this plugin applies it first, as Vite and webpack do.
			name: 'browser-field',
			resolveId: {
				order: 'pre',
				/**
				 * @param {string} source
				 * @param {string | undefined} importer
				 */
				handler: async (source, importer) => {
					if (importer === undefined || !source.startsWith('.') || !importer.includes('/node_modules/')) {
						return null;
					}

					const root = packageOf(importer);
					/** @type {{ browser?: unknown }} */
					const manifest = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
					const key = `./${relative(root, resolve(dirname(importer), source))}`;

					if (typeof manifest.browser !== 'object' || manifest.browser === null || !(key in manifest.browser)) {
						return null;
					}

					/** @type {unknown} */
					const target = manifest.browser[/** @type {keyof typeof manifest.browser} */ (key)];

					if (target === false) {
						return empty;
					}

					return typeof target === 'string' ? resolve(root, target) : null;
				},
			},
			/** @param {string} id */
			load: (id) => (id === empty ? 'export default {};' : null),
		},
		{
			// A module that ends in ?raw comes in as its text, as the worker of loaders.gl does (P-03).
			name: 'raw-text',
			/**
			 * @param {string} source
			 * @param {string | undefined} importer
			 */
			resolveId: async function (source, importer) {
				if (!source.endsWith('?raw')) {
					return null;
				}

				const resolved = await this.resolve(source.slice(0, -'?raw'.length), importer, { skipSelf: true });

				// The plugin of CommonJS marks the file it resolves with a null byte and a query of its own.
				return resolved === null ? null : `${resolved.id.replace(/^\0/, '').replace(/\?.*$/, '')}?raw`;
			},
			/** @param {string} id */
			load: async (id) =>
				id.endsWith('?raw')
					? `export default ${JSON.stringify(await readFile(id.slice(0, -'?raw'.length), 'utf8'))};`
					: null,
		},
	],
};

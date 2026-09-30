import { fileURLToPath } from 'node:url';
import { defineEndpoint } from '@directus/extensions-sdk';

// The worker of MapLibre and the module it imports, which the build copies beside the bundle as MapLibre publishes
// them, in a folder named after the version (extension.config.js).
const files = new Set(['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']);
const folder = new URL('maplibre-gl/', import.meta.url);

export default defineEndpoint({
	id: 'geospatial-spikes-layout',
	handler: (router) => {
		// The worker of MapLibre 6 is a module beside the one that starts it, and the API serves only the chunks it
		// bundles, so the map starts the worker from here, through setWorkerUrl (F01-14). It is the code of a library, so
		// anyone reads it, and the version in the path lets the browser keep it for good.
		router.get('/maplibre-gl/:version/:file', (req, res, next) => {
			const { version, file } = req.params;

			if (!/^\d+\.\d+\.\d+$/.test(version) || !files.has(file)) {
				next();

				return;
			}

			res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
			res.sendFile(fileURLToPath(new URL(`${version}/${file}`, folder)), (error?: Error) => {
				if (error !== undefined) {
					next();
				}
			});
		});
	},
});

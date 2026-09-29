import { MVTLayer } from '@deck.gl/geo-layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import worker from '@loaders.gl/mvt/mvt-worker.js?raw';
import type { Map } from 'maplibre-gl';

// loaders.gl parses each tile in a worker, which it fetches from unpkg.com by default, a CDN the CSP of the Studio does
// not let scripts come from (V-33). The worker comes in this chunk instead, as text, and starts from a blob: URL,
// which the CSP allows (P-03).
const workerUrl = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));

// The tiles of the occurrences of the suite, from the route of the proof of F01-13, with the session of the Studio.
const tiles = `${new URL('../', document.baseURI).href}geospatial-spikes/tile/occurrences/{z}/{x}/{y}`;

// deck.gl on the canvas of MapLibre, with a layer of vector tiles. It resolves once the layer has the tiles of the view.
export const addDeckLayer = (map: Map): Promise<void> =>
	new Promise((resolve, reject) => {
		const layer = new MVTLayer({
			id: 'occurrences',
			data: tiles,
			loadOptions: { mvt: { workerUrl } },
			pointRadiusUnits: 'pixels',
			getPointRadius: 6,
			getFillColor: [200, 40, 90],
			onViewportLoad: () => {
				resolve();
			},
			onTileError: (error: unknown) => {
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		});

		map.addControl(new MapboxOverlay({ interleaved: true, layers: [layer] }));
	});

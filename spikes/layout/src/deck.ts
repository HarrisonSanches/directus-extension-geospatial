import { MVTLayer } from '@deck.gl/geo-layers';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import worker from '@loaders.gl/mvt/mvt-worker.js?raw';
import type { Map } from 'maplibre-gl';
import { tiles } from './tiles.js';

// loaders.gl parses each tile in a worker, which it fetches from unpkg.com by default, a CDN the CSP of the Studio does
// not let scripts come from (V-33). The worker comes in this chunk instead, as text, and starts from a blob: URL,
// which the CSP allows (P-03).
const workerUrl = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));

// deck.gl on the canvas of MapLibre, with a layer of vector tiles. It resolves once the layer has the tiles of the view
// and the map is idle again, with them drawn. The layer goes below the first label of the basemap, so the names of the
// streets stay above the data (D-010). The points have a radius in meters, wide enough to pass under a name in the
// screenshots of F01-15.
export const addDeckLayer = (map: Map): Promise<void> =>
	new Promise((resolve, reject) => {
		const layer = new MVTLayer({
			id: 'occurrences',
			data: tiles,
			beforeId: map.getStyle().layers.find(({ type }) => type === 'symbol')?.id,
			loadOptions: { mvt: { workerUrl } },
			pointRadiusUnits: 'meters',
			getPointRadius: 400,
			getFillColor: [200, 40, 90, 160],
			onViewportLoad: () => {
				map.once('idle', () => {
					resolve();
				});
				map.triggerRepaint();
			},
			onTileError: (error: unknown) => {
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		});

		// MapLibreOverlay draws through the public API of MapLibre, which is all MapLibre 6 has (F01-15).
		map.addControl(new MapLibreOverlay({ interleaved: true, layers: [layer] }));
	});

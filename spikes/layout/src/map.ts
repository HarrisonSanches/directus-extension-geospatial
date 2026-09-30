import { getVersion, Map, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { tiles } from './tiles.js';
import { basemap, marks, view, viewKey } from './view.js';

performance.mark(marks.maplibre);

// What the proof reads from the map each time it is idle, with every tile of the view drawn: the layers of its style,
// in the order MapLibre draws them. The style MapLibre serializes leaves out the custom layers, as the one deck.gl
// draws in, and the order of the map has them.
export type Layers = { id: string; type: string | undefined }[];

// The worker of MapLibre 6 is a module beside the one that starts it, which the API does not serve. It comes from the
// route of the bundle instead, in the version of this MapLibre, and the CSP lets a worker of the same origin start.
const workerUrl = () =>
	new URL(`../geospatial-spikes-layout/maplibre-gl/${getVersion()}/maplibre-gl-worker.mjs`, document.baseURI).href;

// The view of view.ts, or the one the proof of F01-16 left in the storage of the page.
const viewOf = (): typeof view => {
	const stored = localStorage.getItem(viewKey);

	return stored === null ? view : (JSON.parse(stored) as typeof view);
};

// The occurrences in a vector source of MapLibre, as the layout of F04 draws the tiles (§7.1), below the first label of
// the basemap. MapLibre asks for each tile from its worker, with the session cookie of the Studio, and the tile holds
// one layer, named after the collection.
const addTiles = (map: Map) => {
	map.addSource('occurrences', { type: 'vector', tiles: [tiles] });
	map.addLayer(
		{
			id: 'occurrences-tile',
			type: 'circle',
			source: 'occurrences',
			'source-layer': 'occurrences',
			paint: { 'circle-radius': 4, 'circle-color': '#1f6f8b' },
		},
		map.getStyle().layers.find(({ type }) => type === 'symbol')?.id,
	);
	map.on('sourcedata', (event) => {
		if (
			event.sourceId === 'occurrences' &&
			event.tile !== undefined &&
			performance.getEntriesByName(marks.firstTile).length === 0
		) {
			performance.mark(marks.firstTile);
		}
	});
};

export const mountMap = async (
	container: HTMLElement,
	onIdle: (layers: Layers) => void,
): Promise<{ map: Map; remove: () => void }> => {
	setWorkerUrl(workerUrl());

	const map = new Map({ container, style: basemap, ...viewOf() });

	// The source goes in as soon as the style is read, so its tiles come beside the ones of the basemap.
	map.once('style.load', () => {
		addTiles(map);
	});
	map.on('idle', () => {
		onIdle(map.getLayersOrder().map((id) => ({ id, type: map.getLayer(id)?.type })));
	});
	await map.once('load');
	performance.mark(marks.tiles);

	return {
		map,
		remove: () => {
			map.remove();
		},
	};
};

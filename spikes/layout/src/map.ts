import { getVersion, Map, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemap, view } from './view.js';

// What the proof reads from the map each time it is idle, with every tile of the view drawn: the layers of its style,
// in the order MapLibre draws them. The style MapLibre serializes leaves out the custom layers, as the one deck.gl
// draws in, and the order of the map has them.
export type Layers = { id: string; type: string | undefined }[];

// The worker of MapLibre 6 is a module beside the one that starts it, which the API does not serve. It comes from the
// route of the bundle instead, in the version of this MapLibre, and the CSP lets a worker of the same origin start.
const workerUrl = () =>
	new URL(`../geospatial-spikes-layout/maplibre-gl/${getVersion()}/maplibre-gl-worker.mjs`, document.baseURI).href;

export const mountMap = async (
	container: HTMLElement,
	onIdle: (layers: Layers) => void,
): Promise<{ map: Map; remove: () => void }> => {
	setWorkerUrl(workerUrl());

	const map = new Map({ container, style: basemap, ...view });

	map.on('idle', () => {
		onIdle(map.getLayersOrder().map((id) => ({ id, type: map.getLayer(id)?.type })));
	});
	await map.once('load');

	return {
		map,
		remove: () => {
			map.remove();
		},
	};
};

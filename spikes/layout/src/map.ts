import { getVersion, Map, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// A style with no request of its own, a background and a point in São Paulo, where the occurrences of the suite are.
// The basemaps come in F04, and the proof only needs the map drawn by MapLibre.
const style = {
	version: 8 as const,
	sources: {
		center: {
			type: 'geojson' as const,
			data: { type: 'Point' as const, coordinates: [-46.63, -23.55] },
		},
	},
	layers: [
		{ id: 'background', type: 'background' as const, paint: { 'background-color': '#dfe6ee' } },
		{
			id: 'center',
			type: 'circle' as const,
			source: 'center',
			paint: { 'circle-radius': 8, 'circle-color': '#3a6ea5' },
		},
	],
};

// The worker of MapLibre 6 is a module beside the one that starts it, which the API does not serve. It comes from the
// route of the bundle instead, in the version of this MapLibre, and the CSP lets a worker of the same origin start.
const workerUrl = () =>
	new URL(`../geospatial-spikes-layout/maplibre-gl/${getVersion()}/maplibre-gl-worker.mjs`, document.baseURI).href;

export const mountMap = async (container: HTMLElement): Promise<{ map: Map; remove: () => void }> => {
	setWorkerUrl(workerUrl());

	const map = new Map({ container, style, center: [-46.63, -23.55], zoom: 9 });

	await map.once('load');

	return {
		map,
		remove: () => {
			map.remove();
		},
	};
};

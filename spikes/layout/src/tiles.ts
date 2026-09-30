import { tileQueryKey } from './view.js';

const query = localStorage.getItem(tileQueryKey) ?? '';

// The tiles of the occurrences of the suite, from the route of the proof of F01-13, with the session of the Studio.
export const tiles = `${new URL('../', document.baseURI).href}geospatial-spikes/tile/occurrences/{z}/{x}/{y}${query === '' ? '' : `?${query}`}`;

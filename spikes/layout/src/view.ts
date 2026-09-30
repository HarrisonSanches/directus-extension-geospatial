// Where the map of the proofs opens: between two occurrences of the south zone of the suite, at a zoom that shows the
// names of the streets. The proof of F01-15 reads it too, to turn a place into the pixel it clicks.
export const view = { center: [-46.695, -23.655] as [number, number], zoom: 14 };

// The light style of OpenFreeMap, the default basemap, which needs no key (D-011).
export const basemap = 'https://tiles.openfreemap.org/styles/positron';

// Where the proof of F01-16 keeps, in the storage of the page, another view for the map to open on, and the query it
// adds to the address of each tile, such as the prefilter.
export const viewKey = 'geospatial-spike-view';
export const tileQueryKey = 'geospatial-spike-tile-query';

// The moments on the way to the first tile, which the proof of F01-16 reads from the timeline of the page: the layout
// mounted, the code of MapLibre ran, the first tile of the occurrences came in, and every tile of the view is drawn.
export const marks = {
	mount: 'geospatial-spike:mount',
	maplibre: 'geospatial-spike:maplibre',
	firstTile: 'geospatial-spike:first-tile',
	tiles: 'geospatial-spike:tiles',
};

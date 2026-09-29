import type { Map } from 'maplibre-gl';
import { type GeoJSONStoreFeatures, TerraDraw, TerraDrawCircleMode, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

export type Tool = 'circle' | 'polygon';

// Terra Draw on the map, with the geodesic circle and the polygon (D-012). Each time a shape is finished, onFinish gets
// every shape Terra Draw keeps.
export const startDrawing = (map: Map, onFinish: (features: GeoJSONStoreFeatures[]) => void) => {
	const draw = new TerraDraw({
		adapter: new TerraDrawMapLibreGLAdapter({ map }),
		// The globe projection of the circle places each vertex at the radius from the center, over the curve of the Earth.
		modes: [new TerraDrawCircleMode({ projection: 'globe' }), new TerraDrawPolygonMode()],
	});

	draw.start();
	draw.on('finish', () => {
		onFinish(draw.getSnapshot());
	});

	return {
		use: (tool: Tool) => {
			draw.setMode(tool);
		},
		stop: () => {
			draw.stop();
		},
	};
};

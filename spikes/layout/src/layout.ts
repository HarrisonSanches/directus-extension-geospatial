import type { Map } from 'maplibre-gl';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Tool } from './draw.js';
import type { Layers } from './map.js';

type State = 'off' | 'loading' | 'loaded' | 'failed';

// Runs a step that loads a library, with its state in the ref, once.
const load = async (state: { value: State }, step: () => Promise<void>) => {
	if (state.value !== 'off') {
		return;
	}

	state.value = 'loading';

	try {
		await step();
		state.value = 'loaded';
	} catch (error) {
		state.value = 'failed';
		throw error;
	}
};

// The map of the layout. MapLibre comes in a dynamic import when the layout mounts, deck.gl in another when its layer
// is turned on, and Terra Draw in a third when a tool is picked, so none of them is in the file of extensions the
// Studio downloads when it starts (D-010). The state of each goes on the element, for the proofs to read, with the
// layers of the map and the shapes Terra Draw keeps.
export default defineComponent({
	setup() {
		const container = ref<HTMLElement>();
		const map = ref<State>('loading');
		const deck = ref<State>('off');
		const draw = ref<State>('off');
		const layers = ref<Layers>([]);
		const drawn = ref<GeoJSONStoreFeatures[]>([]);
		let mounted: { map: Map; remove: () => void } | undefined;
		let drawing: { use: (tool: Tool) => void; stop: () => void } | undefined;

		onMounted(async () => {
			try {
				const { mountMap } = await import('./map.js');

				if (container.value === undefined) {
					throw new Error('The layout has no element for the map.');
				}

				mounted = await mountMap(container.value, (current) => {
					layers.value = current;
				});
				map.value = 'loaded';
			} catch (error) {
				map.value = 'failed';
				throw error;
			}
		});

		onBeforeUnmount(() => {
			drawing?.stop();
			mounted?.remove();
		});

		const turnOnDeck = () =>
			load(deck, async () => {
				if (mounted === undefined) {
					throw new Error('The map is not loaded.');
				}

				const { addDeckLayer } = await import('./deck.js');

				await addDeckLayer(mounted.map);
			});

		const pick = async (tool: Tool) => {
			await load(draw, async () => {
				if (mounted === undefined) {
					throw new Error('The map is not loaded.');
				}

				const { startDrawing } = await import('./draw.js');

				drawing = startDrawing(mounted.map, (features) => {
					drawn.value = features;
				});
			});
			drawing?.use(tool);
		};

		return () =>
			h(
				'div',
				{
					class: 'geospatial-spike',
					'data-map': map.value,
					'data-deck': deck.value,
					'data-draw': draw.value,
					'data-layers': JSON.stringify(layers.value),
					'data-drawn': JSON.stringify(drawn.value),
				},
				[
					h('button', { type: 'button', class: 'geospatial-spike-deck', onClick: turnOnDeck }, 'deck.gl'),
					h('button', { type: 'button', class: 'geospatial-spike-circle', onClick: () => pick('circle') }, 'Circle'),
					h('button', { type: 'button', class: 'geospatial-spike-polygon', onClick: () => pick('polygon') }, 'Polygon'),
					h('div', { ref: container, class: 'geospatial-spike-map', style: { height: '480px' } }),
				],
			);
	},
});

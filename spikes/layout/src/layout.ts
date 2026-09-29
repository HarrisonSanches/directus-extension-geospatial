import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';

type State = 'off' | 'loading' | 'loaded' | 'failed';

// The map of the layout. MapLibre comes in a dynamic import when the layout mounts, and deck.gl in another when its
// layer is turned on, so neither is in the file of extensions the Studio downloads when it starts (D-010). The state
// of each goes on the element, for the proof to read.
export default defineComponent({
	setup() {
		const container = ref<HTMLElement>();
		const map = ref<State>('loading');
		const deck = ref<State>('off');
		let remove: (() => void) | undefined;
		let addDeck: (() => Promise<void>) | undefined;

		onMounted(async () => {
			try {
				const { mountMap } = await import('./map.js');

				if (container.value === undefined) {
					throw new Error('The layout has no element for the map.');
				}

				const mounted = await mountMap(container.value);

				remove = mounted.remove;
				addDeck = async () => {
					const { addDeckLayer } = await import('./deck.js');

					await addDeckLayer(mounted.map);
				};
				map.value = 'loaded';
			} catch (error) {
				map.value = 'failed';
				throw error;
			}
		});

		onBeforeUnmount(() => remove?.());

		const turnOnDeck = async () => {
			if (addDeck === undefined || deck.value !== 'off') {
				return;
			}

			deck.value = 'loading';

			try {
				await addDeck();
				deck.value = 'loaded';
			} catch (error) {
				deck.value = 'failed';
				throw error;
			}
		};

		// The button turns deck.gl on, and so does an event of the proof, since the Studio of a new project opens a dialog
		// whose focus trap stops every click outside it.
		return () =>
			h(
				'div',
				{
					class: 'geospatial-spike',
					'data-map': map.value,
					'data-deck': deck.value,
					onGeospatialSpikeDeck: turnOnDeck,
				},
				[
					h('button', { type: 'button', class: 'geospatial-spike-deck', onClick: turnOnDeck }, 'deck.gl'),
					h('div', { ref: container, class: 'geospatial-spike-map', style: { height: '480px' } }),
				],
			);
	},
});

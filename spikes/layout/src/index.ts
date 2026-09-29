import { defineLayout } from '@directus/extensions-sdk';
import { defineComponent } from 'vue';
import Layout from './layout.js';

const nothing = defineComponent({ render: () => null });

// A layout with a map and nothing else, whose libraries only reach the Studio when it opens (F01-14).
export default defineLayout({
	id: 'geospatial-spike-map',
	name: 'Spike map',
	icon: 'map',
	component: Layout,
	slots: { options: nothing, sidebar: nothing, actions: nothing },
	setup: () => ({}),
});

// The build of the extensions SDK bundles every import it can resolve, and keeps out only the modules Directus
// provides to sandboxed extensions. The spikes import the internals of Directus from @directus/api, which must come
// from the running Directus and never ship in the bundle (D-001, V-60). The SDK reads this file only as JavaScript.
export default {
	plugins: [
		{
			name: 'directus-api-external',
			/** @param {string} source */
			resolveId: (source) =>
				source === '@directus/api' || source.startsWith('@directus/api/') ? { id: source, external: true } : null,
		},
	],
};

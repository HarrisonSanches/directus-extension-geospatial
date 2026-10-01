// The build of the extensions SDK bundles every import it can resolve, and keeps out only the modules Directus
// provides to sandboxed extensions. The internals come from @directus/api, which must be the running Directus and
// never ship in the bundle (D-001, D-019, V-60): with this plugin, they stay imports even if the package is ever
// installed, and the build gives no warning for a package it cannot find (V-141). The SDK reads this file only as
// JavaScript.
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

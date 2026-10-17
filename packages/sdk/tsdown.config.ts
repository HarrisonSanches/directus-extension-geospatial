import { defineConfig } from 'tsdown';

// The SDK in ESM and in CommonJS, as @directus/sdk ships, for browsers and Node alike. The contract is a private package
// of the workspace, so its code and its types go inside the SDK, and the build fails if the SDK imports anything but
// @directus/sdk, the peer. The types of the contract need the eager emit, since its entry imports the JSON document.
export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	platform: 'neutral',
	dts: { eager: true },
	deps: {
		onlyImport: ['@directus/sdk'],
		dts: { alwaysBundle: ['directus-geospatial-contract'] },
	},
});

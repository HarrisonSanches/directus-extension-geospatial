import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['packages/*/src/**/*.ts', 'dev/*.ts'],
			// The generated types have no runtime code, and the declarations only describe what Directus attaches.
			exclude: ['**/*.test.ts', 'packages/contract/src/generated/**', 'packages/*/src/**/*.d.ts'],
		},
	},
});

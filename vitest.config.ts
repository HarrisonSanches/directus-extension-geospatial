import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['packages/*/src/**/*.ts', 'dev/*.ts'],
			// The generated types have no runtime code, and the declarations only describe what Directus attaches.
			exclude: ['**/*.test.ts', 'packages/contract/src/generated/**', 'packages/*/src/**/*.d.ts'],
			// test/coverage.ts sums this report with the coverage recorded inside Directus by the integration suite.
			reportsDirectory: 'coverage/unit',
		},
		// The global setup of the integration suite stops Directus and waits for Node to write the coverage recorded
		// inside the container. The option applies to the whole run, not to one project.
		teardownTimeout: 120_000,
		projects: [
			{
				extends: true,
				test: { name: 'unit', exclude: [...configDefaults.exclude, 'test/**'] },
			},
			{
				extends: true,
				test: {
					name: 'integration',
					include: ['test/**/*.test.ts'],
					// Starts Directus and the database in containers once, for every test file.
					globalSetup: ['test/setup.ts'],
					testTimeout: 30_000,
				},
			},
		],
	},
});

import { configDefaults, defineConfig } from 'vitest/config';
import { selectDialects } from './spikes/dialects/dialects.ts';
import { selectCombinations } from './test/combinations.ts';

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
		// Starts Directus and the database of every combination of the run in containers, at once, for every test file.
		// At the root it runs once, and the projects do not extend the root, so they do not run it again.
		globalSetup: ['test/setup.ts'],
		// The global setup stops Directus and waits for Node to write the coverage recorded inside the containers. The
		// option applies to the whole run, not to one project.
		teardownTimeout: 120_000,
		projects: [
			{ test: { name: 'unit', exclude: [...configDefaults.exclude, 'test/**', 'spikes/**'] } },
			// A project for each combination of the integration suite, and INTEGRATION picks some of them.
			...selectCombinations(process.env.INTEGRATION).map((combination) => ({
				test: {
					name: `integration:${combination}`,
					include: ['test/**/*.test.ts'],
					provide: { combination },
					testTimeout: 30_000,
				},
			})),
			// The proofs of F01, in the same combinations, with their extensions loaded beside the extension. Only pnpm
			// spike runs them, and they leave when the phase closes.
			...selectCombinations(process.env.INTEGRATION).map((combination) => ({
				test: {
					name: `spike:${combination}`,
					include: ['spikes/*.test.ts'],
					provide: { combination, extensions: ['spikes/extension', 'spikes/hook'] },
					testTimeout: 30_000,
				},
			})),
			// The proof of the envelope on each database outside the suite, on Directus 11.17, with a global setup of its
			// own, which the one at the root leaves alone (F01-08). Only pnpm spike:dialects runs them, and DIALECTS picks
			// some of them.
			...selectDialects(process.env.DIALECTS).map((dialect) => ({
				test: {
					name: `spike-dialect:${dialect}`,
					include: ['spikes/dialects/*.test.ts'],
					globalSetup: ['spikes/dialects/setup.ts'],
					provide: { dialect },
					testTimeout: 30_000,
				},
			})),
		],
	},
});

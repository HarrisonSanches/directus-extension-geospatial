import { configDefaults, defineConfig } from 'vitest/config';
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
			{ test: { name: 'unit', exclude: [...configDefaults.exclude, 'test/**'] } },
			// A project for each combination of the integration suite, and INTEGRATION picks some of them.
			...selectCombinations(process.env.INTEGRATION).map((combination) => ({
				test: {
					name: `integration:${combination}`,
					include: ['test/**/*.test.ts'],
					provide: { combination },
					testTimeout: 30_000,
				},
			})),
			// The measurements, which only pnpm measure runs, one combination at a time: the radius on 11.17 with the oldest and
			// the newest PostGIS, and the permitted query on 11.17 and on 12 (F02-07). INTEGRATION picks others.
			...selectCombinations(process.env.INTEGRATION ?? '11.17-postgis,11.17-postgis-newest,12-postgis').map(
				(combination) => ({
					test: {
						name: `measure:${combination}`,
						include: ['test/measure/*.measure.ts'],
						provide: { combination, extensions: ['test/measure/observer'], measure: true },
						testTimeout: 30_000,
					},
				}),
			),
		],
	},
});

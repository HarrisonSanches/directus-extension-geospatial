import { configDefaults, defineConfig } from 'vitest/config';
import { selectCombinations } from './test/combinations.ts';

// The combinations of the integration suite in this run.
const integration = selectCombinations(process.env.INTEGRATION);

// The test files that start a Directus of their own, beside the one of the combination (docs/padroes/testes.md).
const ownEnvironments = 'test/**/*.environment.test.ts';

// With several combinations in one run, on one machine, the files with an environment of their own run after the rest,
// so their Directus start while the Directus of the combinations are not busy with the suite, which put them past their
// pressure limiter (A-078). A job of the CI runs one combination, and both run at the same time, as before.
const ownEnvironmentsGroup = integration.length > 1 ? 1 : 0;

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['packages/*/src/**/*.ts', 'dev/*.ts'],
			// The generated types have no runtime code, the declarations only describe what Directus attaches, and the
			// collections of the docs site are a config that only Astro loads, when it builds the site.
			exclude: [
				'**/*.test.ts',
				'packages/contract/src/generated/**',
				'packages/*/src/**/*.d.ts',
				'packages/docs/src/content.config.ts',
			],
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
			// The unit tests of the SDK of the extension again, on the oldest @directus/sdk its peer accepts, which the
			// catalog keeps under a name of its own (V-191).
			{
				resolve: { alias: { '@directus/sdk': 'directus-sdk-oldest' } },
				test: { name: 'unit:sdk-oldest', include: ['packages/sdk/src/**/*.test.ts'] },
			},
			// Two projects for each combination of the integration suite, and INTEGRATION picks some of them: the files on the
			// Directus of the combination, and the ones with an environment of their own.
			...integration.flatMap((combination) => [
				{
					test: {
						name: `integration:${combination}`,
						include: ['test/**/*.test.ts'],
						exclude: [...configDefaults.exclude, ownEnvironments],
						provide: { combination },
						testTimeout: 30_000,
					},
				},
				{
					test: {
						name: `integration:${combination}:environments`,
						include: [ownEnvironments],
						provide: { combination },
						testTimeout: 30_000,
						sequence: { groupOrder: ownEnvironmentsGroup },
					},
				},
			]),
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

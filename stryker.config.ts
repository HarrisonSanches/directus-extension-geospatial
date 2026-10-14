import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

// The mutation testing of the golden rule (D-017, docs/padroes/testes.md): each mutant of the code that decides what a
// user receives runs against the unit tests, and at least 90% of them have to fail one. The integration suite takes no
// part, since each mutant would need a build and a Directus of its own. Stryker finds only JSON and JavaScript by name,
// and imports any other file it is given, which Node runs by stripping its types.
export default {
	// The runner of Vitest of Stryker 10 runs no test against a mutant on Vitest 5 (V-193). The command runs the unit
	// tests of the extension for each mutant instead, with the mutant switched on by an environment variable, and the
	// first test that fails ends the run.
	testRunner: 'command',
	commandRunner: {
		command: 'vitest run --config vitest.mutation.config.ts --bail 1 --silent --no-file-parallelism',
	},
	coverageAnalysis: 'off',
	// Many runs go at once, each taking seconds, so a mutant counts as a timeout only past a minute.
	timeoutMS: 60_000,
	// The chain to the internals of Directus and the check of them at startup, the envelope of each database around the
	// permitted query, the fields each item brings, the input the extension refuses, and the registered query: its $NOW,
	// its id, the cursor sealed to its list and the key of the total kept for the same permissions (D-006).
	mutate: [
		'packages/extension/src/internals/{accepted,adapters,chain,check,modules,page,permitted,startup}.ts',
		'packages/extension/src/db/{fail-closed,keyset,postgis,spatialite}.ts',
		'packages/extension/src/operations/request.ts',
		'packages/extension/src/operations/radius/{items,summary}.ts',
		'packages/extension/src/query/{counts,cursor,id,key,now,register}.ts',
	],
	thresholds: { high: 95, low: 90, break: 90 },
	// The report to read in a browser, and the same in JSON, which lists each mutant that survived.
	reporters: ['html', 'json', 'clear-text', 'progress'],
	htmlReporter: { fileName: 'reports/mutation/index.html' },
	jsonReporter: { fileName: 'reports/mutation/mutation.json' },
} satisfies PartialStrykerOptions;

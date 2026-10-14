import { defineConfig } from 'vitest/config';

// The unit tests of the extension, which the mutation testing runs against each mutant (stryker.config.ts), without the
// projects of the integration suite that vitest.config.ts declares.
export default defineConfig({
	test: {
		include: ['packages/extension/src/**/*.test.ts'],
		// Each mutant runs in a Vitest of its own, many at once, so none writes the results it keeps for the next run.
		cache: false,
	},
});

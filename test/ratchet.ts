import { readFile, writeFile } from 'node:fs/promises';
import { type CoverageMapData, createCoverageMap } from '@vitest/istanbul-lib-coverage';

// The ratchet of the summed coverage: the floor of each measure, which a run on a machine raises when the coverage
// rises and the CI only checks. It runs after test/coverage.ts, and in the CI after the upload to Codecov and the
// analysis of SonarQube Cloud, so a pull request that lowers the coverage still shows where.
const summedFile = new URL('../coverage/all/coverage-final.json', import.meta.url);
const thresholdsFile = new URL('coverage-thresholds.json', import.meta.url);
const measures = ['lines', 'statements', 'functions', 'branches'] as const;

type Thresholds = Record<(typeof measures)[number], number>;

const readJson = async <T>(path: URL): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

// Rounded down to one decimal, so the limit never sits above what a run measured. istanbul says Unknown for a
// measure with nothing to count, which is fully covered.
const floor = (pct: number | 'Unknown'): number =>
	pct === 'Unknown' ? 100 : Math.floor(Math.round(pct * 100) / 10) / 10;

// A run of some combinations measures less than the sum of all of them, so only a full run counts.
if (process.env.INTEGRATION !== undefined && process.env.INTEGRATION.trim() !== '') {
	process.stdout.write('INTEGRATION picks some combinations, so the ratchet of the coverage is not checked.\n');
} else {
	const summary = createCoverageMap(await readJson<CoverageMapData>(summedFile)).getCoverageSummary();
	const current = Object.fromEntries(measures.map((measure) => [measure, floor(summary[measure].pct)])) as Thresholds;
	const limits = await readJson<Thresholds>(thresholdsFile);
	const fallen = measures.filter((measure) => current[measure] < limits[measure]);
	const risen = measures.filter((measure) => current[measure] > limits[measure]);

	if (fallen.length > 0) {
		const lines = fallen.map((measure) => `${measure} ${String(current[measure])}% < ${String(limits[measure])}%`);

		process.stderr.write(`The coverage fell below the ratchet: ${lines.join(', ')}.\n`);
		process.exitCode = 1;
	} else if (risen.length > 0 && process.env.CI === undefined) {
		await writeFile(thresholdsFile, `${JSON.stringify(current, null, '\t')}\n`);
		process.stdout.write(`The coverage rose, and the ratchet moved up to ${JSON.stringify(current)}.\n`);
	} else if (risen.length > 0) {
		process.stdout.write('The coverage rose. A run of pnpm test:coverage on a machine moves the ratchet up.\n');
	} else {
		process.stdout.write(`The coverage holds the ratchet, at ${JSON.stringify(limits)}.\n`);
	}
}

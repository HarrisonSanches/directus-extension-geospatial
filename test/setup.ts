import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TestProject } from 'vitest/node';
import { type Combination, combinations } from './combinations.ts';
import { collectCoverage } from './coverage.ts';
import { connect, type Directus } from './directus.ts';
import { extension, log, newSecret, openCoverage, seconds, startEnvironment } from './environment.ts';
import { readLicenseKey } from './license.ts';
import { seed } from './seed.ts';

// The other extension of the suite, whose hooks on items.query the radius respects as /items does (V-144). It loads in
// every run, and the coverage, which reads only the bundle of the extension, leaves its code out (test/coverage.ts).
const testHook = 'test/hook';
// The extension that hands over the statement of the radius with its values, which the measurements time and the suite
// reads the plan of (test/measure/observer/).
const observer = 'test/measure/observer';

interface Started {
	combination: Combination;
	directus: Directus;
	stop: () => Promise<void>;
}

// How a run starts each Directus: the folder of the coverage, whether Node records it, the key of the tests, and the
// packages beside the extension.
interface Run {
	coverage: string;
	recordsCoverage: boolean;
	licenseKey: string | undefined;
	packages: readonly string[];
}

// Starts the database and the Directus of one combination, with the packages of the run, and builds the schema, the
// roles and the data.
const start = async (
	combination: Combination,
	{ coverage, recordsCoverage, licenseKey, packages }: Run,
): Promise<Started> => {
	const {
		directus: container,
		url,
		admin: credentials,
		backend,
		stop,
	} = await startEnvironment(combination, coverage, { packages, coverage: recordsCoverage });
	const images = combinations[combination];
	const admin = connect(url, credentials.token);

	// Directus 12 starts on the Core tier, which refuses permissions with rules of their own, and the key of the Open
	// Innovation Grant lifts that (V-114, D-043). Directus 11 has no license key.
	const tiered = Number(images.directus.version.split('.')[0]) >= 12;
	const { activate } = backend;

	if (tiered && licenseKey !== undefined && activate !== undefined) {
		const activatingAt = performance.now();

		await activate(admin, licenseKey);
		log(`${combination}: activated the key on the project of the tests in ${seconds(activatingAt)} s`);
	} else if (tiered) {
		const reason =
			licenseKey === undefined
				? 'DIRECTUS_LICENSE_KEY is empty or missing'
				: 'the key of the tests only goes to the database of their project';

		log(`${combination}: runs on the Core tier, because ${reason}`);
	}

	const customPermissionRules = !tiered || (licenseKey !== undefined && activate !== undefined);
	const tokens = await seed(admin, newSecret, customPermissionRules);

	return {
		combination,
		directus: {
			url,
			tokens: { admin: credentials.token, ...tokens },
			versions: { directus: images.directus.version, ...(await backend.versions(container)) },
			customPermissionRules,
			...(backend.database && { databaseContainer: backend.database.getId() }),
		},
		stop,
	};
};

// Vitest runs the global setup of each project one after the other, so this one, at the root, runs once and starts at
// the same time the combinations of every project of the run. Each project finds its own by name (test/directus.ts).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	// Two projects of a run can share a combination, which starts once.
	const selected = [...new Set(project.vitest.projects.flatMap(({ config }) => config.provide.combination ?? []))];
	const extensions = [...new Set(project.vitest.projects.flatMap(({ config }) => config.provide.extensions ?? []))];
	const measuring = project.vitest.projects.some(({ config }) => config.provide.measure === true);
	const [first] = selected;

	// A run of the unit tests alone starts nothing.
	if (first === undefined) {
		return () => Promise.resolve();
	}

	// A folder for each Directus of the run, the ones of the tests included, with the coverage of its processes.
	const coverage = await mkdtemp(join(tmpdir(), 'geospatial-coverage-'));
	const licenseKey = await readLicenseKey();
	// A run of the measurements loads only its own packages beside the extension, and Directus runs without the coverage,
	// as an installation runs it.
	const run: Run = {
		coverage,
		recordsCoverage: !measuring,
		licenseKey,
		packages: measuring ? [extension, ...extensions] : [extension, testHook, observer, ...extensions],
	};
	const results = await Promise.allSettled(selected.map((combination) => start(combination, run)));
	const started = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
	const failure = results.find((result) => result.status === 'rejected');

	if (failure !== undefined) {
		await Promise.all(started.map(({ stop }) => stop()));
		await rm(coverage, { recursive: true, force: true });
		throw failure.reason;
	}

	project.provide('directus', Object.fromEntries(started.map(({ combination, directus }) => [combination, directus])));
	project.provide('coverage', coverage);

	return async () => {
		try {
			await Promise.all(started.map(({ stop }) => stop()));

			// A run with packages besides the ones of the suite is not the suite, and its coverage would replace the one of
			// the suite.
			if (extensions.length === 0) {
				await openCoverage(coverage, combinations[first].directus.image);
				await collectCoverage(coverage, new URL('../coverage/integration/coverage-final.json', import.meta.url));
			}
		} finally {
			await rm(coverage, { recursive: true, force: true });
		}
	};
}

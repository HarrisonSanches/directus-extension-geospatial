import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { Profiler } from 'node:inspector';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CoverageMapData, createCoverageMap } from '@vitest/istanbul-lib-coverage';
import { create, createContext } from '@vitest/istanbul-lib-report';
import convert from 'ast-v8-to-istanbul';
import { parse } from 'vite';

// The bundle on this machine, and the path Directus imports it from inside the container.
const bundle = new URL('../packages/extension/dist/api.js', import.meta.url);
const bundleInContainer = 'file:///directus/extensions/directus-extension-geospatial/dist/api.js';

const coverageDir = new URL('../coverage/', import.meta.url);

const readJson = async <T>(path: string | URL): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

// Converts the coverage Node recorded inside the containers, a folder in the root for each Directus of the run, into
// the format of the unit coverage, with the same library and parser Vitest uses, so both can be summed. The two sides
// still split the code into statements at slightly different positions, so the sum is a floor (V-118).
export const collectCoverage = async (root: string, output: URL): Promise<void> => {
	const code = await readFile(bundle, 'utf8');
	const sourceMap = await readJson<{ version: number; sources: string[]; mappings: string; names: string[] }>(
		new URL('api.js.map', bundle),
	);

	// The sources of the map are relative to it, and the unit coverage names each file by its absolute path.
	sourceMap.sources = sourceMap.sources.map((source) => fileURLToPath(new URL(source, bundle)));

	// The parser and options behind parseAstAsync of vitest/node, the one @vitest/coverage-v8 converts with.
	const { program, errors } = await parse('api.js', code, { lang: 'js', preserveParens: false });

	if (errors.length > 0) {
		throw new Error(`Could not parse the bundle: ${errors.map(({ message }) => message).join('; ')}`);
	}

	const coverage = createCoverageMap({});

	for (const name of await readdir(root)) {
		const folder = join(root, name);
		let scripts = 0;

		for (const file of await readdir(folder)) {
			const { result } = await readJson<{ result: Profiler.ScriptCoverage[] }>(join(folder, file));

			// Directus imports the bundle with a query string that changes on each load.
			for (const script of result.filter(({ url }) => url.split('?')[0] === bundleInContainer)) {
				scripts++;
				coverage.merge(
					await convert({
						code,
						sourceMap,
						ast: program,
						coverage: { url: bundle.href, functions: script.functions },
					}),
				);
			}
		}

		// Without it, the sum would quietly lose the code that only runs inside that Directus.
		if (scripts === 0) {
			throw new Error(
				`The Directus of ${name} wrote no coverage of the extension. It has to stop gracefully, within the stop timeout.`,
			);
		}
	}

	await mkdir(new URL('.', output), { recursive: true });
	await writeFile(output, JSON.stringify(coverage.toJSON()));
};

// The coverage of each run of the integration suite: one file for the whole run on a machine, and one for each job
// of the CI, which the coverage job downloads into a folder of its own.
const integrationFiles = async (): Promise<URL[]> => {
	const folder = new URL('integration/', coverageDir);
	const files = (await readdir(folder, { recursive: true })).filter((file) => file.endsWith('coverage-final.json'));

	// Without it, the sum would be the unit coverage alone.
	if (files.length === 0) {
		throw new Error(`No coverage of the integration suite in ${fileURLToPath(folder)}.`);
	}

	return files.map((file) => new URL(file, folder));
};

// Sums the coverage of the unit tests and of the integration suite, prints it and writes the reports that Codecov,
// SonarQube Cloud and the ratchet of test/ratchet.ts read. Only the files of the unit coverage count, which are the
// ones the Vitest configuration includes.
if (import.meta.main) {
	const coverage = createCoverageMap(await readJson<CoverageMapData>(new URL('unit/coverage-final.json', coverageDir)));
	const included = new Set(coverage.files());

	for (const file of await integrationFiles()) {
		const integration = createCoverageMap(await readJson<CoverageMapData>(file));

		integration.filter((name) => included.has(name));
		coverage.merge(integration);
	}

	const context = createContext({ dir: fileURLToPath(new URL('all', coverageDir)), coverageMap: coverage });

	for (const report of [create('text'), create('json'), create('lcovonly')]) {
		report.execute(context);
	}
}

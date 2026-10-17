import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { Profiler } from 'node:inspector';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoverageMap, type FileCoverageData, type Range } from '@vitest/istanbul-lib-coverage';
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
// still split the code into pieces at slightly different positions (V-118), which alignedTo below evens out where it
// can.
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

// Where a piece of code starts, by line and column.
const startOf = ({ start }: Range): string => `${String(start.line)}:${String(start.column)}`;

// The pieces of one kind, by a key of where each starts. A key two pieces share is left without one, since a piece of
// the other side could be either.
const byStart = <T>(pieces: Record<string, T>, keyOf: (piece: T) => string): Map<string, T | undefined> => {
	const starts = new Map<string, T | undefined>();

	for (const piece of Object.values(pieces)) {
		const key = keyOf(piece);

		starts.set(key, starts.has(key) ? undefined : piece);
	}

	return starts;
};

// The library sums two pieces only when both their start and their end match, and the two sides often end the same
// piece at another column: a statement of endpoint.ts that ends at column 75 in the unit coverage ends at 72 in the
// integration one. The sum then counts it twice, and the copy one side never ran stays uncovered, even with the other
// side running it. So each piece of the integration takes the position of the piece of the unit coverage that starts at
// the same place, and counts once. A piece that starts elsewhere still counts apart, so the sum stays a floor (V-118).
const alignedTo = (unit: FileCoverageData) => {
	const statements = byStart(unit.statementMap, startOf);
	const functions = byStart(unit.fnMap, ({ loc }) => startOf(loc));
	const branches = byStart(unit.branchMap, ({ type, locations: [first] }) =>
		first === undefined ? '' : `${type} ${startOf(first)}`,
	);

	return (integration: FileCoverageData): FileCoverageData => ({
		...integration,
		statementMap: Object.fromEntries(
			Object.entries(integration.statementMap).map(([id, range]) => [id, statements.get(startOf(range)) ?? range]),
		),
		fnMap: Object.fromEntries(
			Object.entries(integration.fnMap).map(([id, piece]) => {
				const same = functions.get(startOf(piece.loc));

				return [id, same === undefined ? piece : { ...piece, decl: same.decl, loc: same.loc }];
			}),
		),
		branchMap: Object.fromEntries(
			Object.entries(integration.branchMap).map(([id, piece]) => {
				const [first] = piece.locations;
				const same = first === undefined ? undefined : branches.get(`${piece.type} ${startOf(first)}`);

				// The hits of a branch go by the order of its locations, so only one with as many sums with it.
				return [
					id,
					same?.locations.length === piece.locations.length
						? { ...piece, loc: same.loc, locations: same.locations }
						: piece,
				];
			}),
		),
	});
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
	const unit = await readJson<Record<string, FileCoverageData>>(new URL('unit/coverage-final.json', coverageDir));
	// Taken before the sum, which adds to the files of the unit coverage the pieces of the integration that start elsewhere.
	const aligners = new Map(Object.entries(unit).map(([name, data]) => [name, alignedTo(data)]));
	const coverage = createCoverageMap(unit);

	for (const file of await integrationFiles()) {
		const integration = await readJson<Record<string, FileCoverageData>>(file);

		coverage.merge(
			createCoverageMap(
				Object.fromEntries(
					Object.entries(integration).flatMap(([name, data]) => {
						const align = aligners.get(name);

						return align === undefined ? [] : [[name, align(data)]];
					}),
				),
			),
		);
	}

	const context = createContext({ dir: fileURLToPath(new URL('all', coverageDir)), coverageMap: coverage });

	for (const report of [create('text'), create('json'), create('lcovonly')]) {
		report.execute(context);
	}
}

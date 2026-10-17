import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const extension = new URL('../packages/extension/', import.meta.url);
const internals = new URL('src/internals/', extension);

// The modules of @directus/api the code of the internals imports when it runs, and not only for its types.
const importsOfInternals = async () => {
	const files = (await readdir(internals)).filter((file) => file.endsWith('.ts') && !/\.(test|d)\.ts$/.test(file));
	const sources = await Promise.all(files.map((file) => readFile(new URL(file, internals), 'utf8')));

	return new Set(
		sources.flatMap((source) =>
			[...source.matchAll(/(?<!typeof )import\('(@directus\/api\/[^']+)'\)/g)].map(([, specifier]) => specifier),
		),
	);
};

// The bundle the suite built, with its source map, which lists every file the build put inside it.
const bundle = async () => ({
	code: await readFile(new URL('dist/api.js', extension), 'utf8'),
	sources: (JSON.parse(await readFile(new URL('dist/api.js.map', extension), 'utf8')) as { sources: string[] }).sources,
});

// The extension uses the internals of the Directus that runs it, under the license of Directus, and never ships them
// (D-019, V-60).
describe('o @directus/api fora do bundle', () => {
	it('cada import dos internos continua um import, do Directus em execução', async () => {
		const { code } = await bundle();
		const specifiers = await importsOfInternals();

		expect(specifiers.size).toBeGreaterThan(0);

		for (const specifier of specifiers) {
			expect(code).toMatch(new RegExp(String.raw`import\((['"])${specifier}\1\)`));
		}
	});

	it('nenhum arquivo do @directus/api entrou no bundle', async () => {
		const { sources } = await bundle();

		expect(sources).toContainEqual(expect.stringMatching(/src\/internals\/modules\.ts$/));
		expect(sources.filter((source) => /@directus[/+]api\b/.test(source))).toEqual([]);
	});
});

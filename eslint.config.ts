import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const extension = 'packages/extension/src';

// The modules of the engine above the adapters, the ones later phases add included (docs/padroes/typescript.md).
const engine = ['operations', 'query', 'capabilities', 'tiles', 'cache', 'queue', 'live', 'reports'].map(
	(folder) => `${extension}/${folder}`,
);

// The name as a regular expression, for no-restricted-imports and for the selectors, where an unescaped slash would end
// the expression (V-167).
const directusApi = String.raw`^@directus\/api(\/|$)`;
const onlyInInternals = 'Only packages/extension/src/internals/ imports @directus/api (D-001).';

// The dependency in the engine goes one way, routes → operations → adapters → internals, and only the internals import
// @directus/api, the code of the running Directus (D-001). The zones resolve from the root they get, and not from the
// folder ESLint runs in, which an editor may change. Exported for eslint.config.test.ts, which lints with it.
export const engineLayers = (root: string) =>
	defineConfig(
		{
			plugins: { 'import-x': importX },
			settings: {
				// The files whose imports the plugin follows, and without which no-cycle sees no TypeScript file.
				'import-x/extensions': ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'],
				// The code imports ./module.js, and the file on disk is ./module.ts.
				'import-x/resolver-next': [
					createNodeResolver({
						extensionAlias: { '.js': ['.ts', '.js'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] },
					}),
				],
			},
		},
		// The zones compare the file an import resolves to, the dynamic import() included, and skip what does not resolve
		// (V-167).
		{
			rules: {
				'import-x/no-restricted-paths': [
					'error',
					{
						basePath: root,
						zones: [
							{
								target: [`${extension}/*/**`, `${extension}/!(endpoint).ts`],
								from: `${extension}/routes`,
								message: 'Nothing imports a route: endpoint.ts registers them.',
							},
							{
								target: [`${extension}/db`, `${extension}/internals`],
								from: engine,
								message: 'An adapter and the internals never import an operation or another module of the engine.',
							},
							{
								target: `${extension}/internals`,
								from: `${extension}/db`,
								message: 'The internals never import an adapter.',
							},
						],
					},
				],
			},
		},
		// @directus/api is declared and not installed (V-141), so no zone resolves it. no-restricted-imports reads the name
		// of a static import, and the dynamic import() and the type of an import() go by their syntax (V-167).
		{
			ignores: [`${extension}/internals/**`],
			rules: {
				'no-restricted-imports': ['error', { patterns: [{ regex: directusApi, message: onlyInInternals }] }],
				'no-restricted-syntax': [
					'error',
					{ selector: `ImportExpression[source.value=/${directusApi}/]`, message: onlyInInternals },
					{
						selector: `ImportExpression > TemplateLiteral > TemplateElement[value.raw=/${directusApi}/]`,
						message: onlyInInternals,
					},
					{ selector: `TSImportType[argument.literal.value=/${directusApi}/]`, message: onlyInInternals },
				],
			},
		},
	);

export default defineConfig(
	// The generated types follow the style of their generator, and a test keeps them in step with openapi.yaml.
	{ ignores: ['**/dist/', '**/coverage/', 'packages/contract/src/generated/'] },

	// A comment that turns a rule off hides the problem instead of fixing it. ESLint ignores every inline
	// configuration and reports each one as a warning, and the lint runs with --max-warnings 0.
	{ linterOptions: { noInlineConfig: true } },

	js.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},
	// The extensions SDK reads its configuration only as JavaScript, which no tsconfig covers, so it is linted without
	// the rules that need types.
	{ files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },

	engineLayers(import.meta.dirname),

	// Imports in the order of the Directus repository: Node, packages, then project files, alphabetical within each
	// group, and the names inside the braces sorted too.
	{
		rules: {
			'import-x/no-cycle': 'error',
			'import-x/order': [
				'error',
				{
					'newlines-between': 'never',
					alphabetize: { order: 'asc', orderImportKind: 'asc', caseInsensitive: true },
				},
			],
			'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true, allowSeparatedGroups: true }],
		},
	},

	{
		rules: {
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{ 'ts-check': false, 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true },
			],
			// The extension logs through the Directus logger.
			'no-console': 'error',
			'no-nested-ternary': 'error',
			// The comments that switch off the formatter or the coverage count, like the ones for the lint and the types.
			'no-warning-comments': [
				'error',
				{ terms: ['prettier-ignore', 'v8 ignore', 'c8 ignore', 'istanbul ignore'], location: 'start' },
			],
		},
	},

	prettier,
);

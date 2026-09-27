import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

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

	// Imports in the order of the Directus repository: Node, packages, then project files, alphabetical within each
	// group, and the names inside the braces sorted too.
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

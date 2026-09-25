import lint from '@commitlint/lint';
import load from '@commitlint/load';
import type { LintOptions } from '@commitlint/types';
import { describe, expect, it } from 'vitest';

// Loads the repository config and lints with the options the commitlint CLI builds, so each case sees what the
// commit-msg hook sees.
const config = await load({}, { cwd: import.meta.dirname });

const options: LintOptions = {
	parserOpts: (config.parserPreset?.parserOpts ?? {}) as LintOptions['parserOpts'],
	plugins: config.plugins,
	ignores: config.ignores ?? [],
	defaultIgnores: config.defaultIgnores !== false,
};

async function lintMessage(message: string) {
	const { errors, warnings } = await lint(message, config.rules, options);
	return { errors: errors.map((error) => error.name), warnings: warnings.map((warning) => warning.name) };
}

describe('padrão de commit', () => {
	it.each([
		['recusa a mensagem sem tipo', 'update files', 'type-empty'],
		['recusa o assunto vago, mesmo com tipo', 'docs: update files', 'subject-vague'],
		['recusa o "wip" como assunto', 'fix: wip', 'subject-vague'],
		['recusa o tipo com maiúscula', 'Feat: add x', 'type-case'],
		['recusa o assunto terminado em ponto', 'feat: add x.', 'subject-full-stop'],
		['recusa o cabeçalho com mais de 72 caracteres', `feat: ${'a'.repeat(67)}`, 'header-max-length'],
		['recusa o escopo fora do kebab-case', 'feat(Radius): add x', 'scope-case'],
		['recusa o corpo sem a linha em branco antes', 'feat: add x\nexplain why', 'body-leading-blank'],
		[
			'recusa o rodapé sem a linha em branco antes',
			'fix: rename x\n\nexplain why\nBREAKING CHANGE: clients must rename x',
			'footer-leading-blank',
		],
	])('%s', async (_rule, message, expectedError) => {
		const { errors } = await lintMessage(message);

		expect(errors).toContain(expectedError);
	});

	it.each([
		['aceita o cabeçalho com escopo', 'feat(radius): order items by distance from the center'],
		[
			'aceita o corpo com o porquê e o rodapé Refs',
			[
				'fix(queue): resume an interrupted job from the last saved batch',
				'',
				'The lease expired while a batch was still writing, and the next worker',
				'started the job from the beginning, duplicating rows.',
				'',
				'Refs: F06-04',
			].join('\n'),
		],
		[
			'aceita a mudança que quebra, com o ! e o BREAKING CHANGE',
			[
				'fix(contract)!: rename the error code MAX_ITEMS to LIMIT_EXCEEDED',
				'',
				'BREAKING CHANGE: clients that check error.code for MAX_ITEMS must check',
				'LIMIT_EXCEEDED. The old code was deprecated in 1.4.',
				'',
				'Refs: F05-02',
			].join('\n'),
		],
		[
			'aceita os rodapés Refs e Co-Authored-By',
			[
				'build: pin the toolchain and enforce the commit standard',
				'',
				'Every commit now passes the commitlint rules before it exists.',
				'',
				'Refs: F00-01',
				'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>',
			].join('\n'),
		],
	])('%s', async (_name, message) => {
		const result = await lintMessage(message);

		expect(result).toEqual({ errors: [], warnings: [] });
	});
});

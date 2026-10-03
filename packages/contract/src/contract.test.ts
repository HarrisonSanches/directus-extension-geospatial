import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { apiVersion, limitMaximum, openapi } from './index.js';

const contract = join(import.meta.dirname, '..');
const generated = join(import.meta.dirname, 'generated');

describe('contrato', () => {
	it('a versão da API é a do documento', async () => {
		const openapi: unknown = parse(await readFile(join(contract, 'openapi.yaml'), 'utf8'));

		expect(openapi).toMatchObject({ info: { version: apiVersion } });
	});

	it('o máximo de uma página é o do documento', async () => {
		const openapi: unknown = parse(await readFile(join(contract, 'openapi.yaml'), 'utf8'));

		expect(openapi).toMatchObject({ components: { schemas: { Limit: { maximum: limitMaximum } } } });
	});

	it('o documento em JSON, que a extensão serve, é o openapi.yaml', async () => {
		expect(openapi).toEqual(parse(await readFile(join(contract, 'openapi.yaml'), 'utf8')));
	});

	it('os tipos gerados estão em dia com o documento', async () => {
		const output = await mkdtemp(join(tmpdir(), 'geospatial-contract-'));

		try {
			// The same command as pnpm generate, with the output in a temporary folder.
			await promisify(execFile)(
				join(contract, 'node_modules', '.bin', 'openapi-ts'),
				['--file', 'openapi-ts.config.ts', '--output', output, '--silent', '--no-log-file'],
				{ cwd: contract },
			);

			for (const file of ['index.ts', 'types.gen.ts']) {
				const committed = join(generated, file);
				const options = { ...(await resolveConfig(committed, { editorconfig: true })), filepath: committed };

				expect(await format(await readFile(join(output, file), 'utf8'), options)).toBe(
					await readFile(committed, 'utf8'),
				);
			}
		} finally {
			await rm(output, { recursive: true, force: true });
		}
	});
});

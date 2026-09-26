import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { fillSecrets, main, newSecret, type Output, prepareEnv } from './env.js';

// A real file in a folder of its own, removed when the test ends.
const envFile = async (content?: string): Promise<string> => {
	const folder = await mkdtemp(join(tmpdir(), 'geospatial-env-'));
	const path = join(folder, '.env');

	onTestFinished(() => rm(folder, { recursive: true }));

	if (content !== undefined) {
		await writeFile(path, content);
	}

	return path;
};

// A predictable source of secrets, so each test knows the values it gets.
const counter = () => {
	let count = 0;

	return () => `secret-${String(++count)}`;
};

// Keeps what the script writes to the terminal.
const terminal = (): Output & { text: string } => ({
	text: '',
	write(text) {
		this.text += text;
	},
});

describe('segredos do ambiente de desenvolvimento', () => {
	it('preenche cada segredo vazio com um valor novo', () => {
		const env = 'DB_PASSWORD=\nSECRET=\nADMIN_PASSWORD=\nADMIN_TOKEN=\n';

		expect(fillSecrets(env, counter())).toEqual({
			env: 'DB_PASSWORD=secret-1\nSECRET=secret-2\nADMIN_PASSWORD=secret-3\nADMIN_TOKEN=secret-4\n',
			filled: ['DB_PASSWORD', 'SECRET', 'ADMIN_PASSWORD', 'ADMIN_TOKEN'],
		});
	});

	it('mantém o segredo que já tem valor, os comentários e as outras variáveis', () => {
		const env = '# Admin\nADMIN_EMAIL=admin@example.com\nDB_PASSWORD=a\nSECRET=b\nADMIN_PASSWORD=c\nADMIN_TOKEN=d\n';

		expect(fillSecrets(env, counter())).toEqual({ env, filled: [] });
	});

	it('acrescenta no fim o segredo que falta no arquivo', () => {
		const env = 'DB_PASSWORD=a\nSECRET=b\nADMIN_PASSWORD=c';

		expect(fillSecrets(env, counter())).toEqual({
			env: 'DB_PASSWORD=a\nSECRET=b\nADMIN_PASSWORD=c\nADMIN_TOKEN=secret-1\n',
			filled: ['ADMIN_TOKEN'],
		});
	});

	it('grava no arquivo os segredos que gerou', async () => {
		const path = await envFile(
			'ADMIN_EMAIL=admin@example.com\nDB_PASSWORD=a\nSECRET=\nADMIN_PASSWORD=c\nADMIN_TOKEN=d\n',
		);

		expect(await prepareEnv(path, counter())).toEqual(['SECRET']);
		expect(await readFile(path, 'utf8')).toBe(
			'ADMIN_EMAIL=admin@example.com\nDB_PASSWORD=a\nSECRET=secret-1\nADMIN_PASSWORD=c\nADMIN_TOKEN=d\n',
		);
	});

	it('sem o arquivo, falha dizendo que ele sai de uma cópia do .env.example', async () => {
		const path = await envFile();

		await expect(prepareEnv(path, counter())).rejects.toThrow('copy dev/.env.example to dev/.env');
	});

	it('diz no terminal quais segredos gerou, e nada quando não gerou nenhum', async () => {
		const path = await envFile('DB_PASSWORD=\nSECRET=\nADMIN_PASSWORD=c\nADMIN_TOKEN=d\n');
		const [out, err] = [terminal(), terminal()];

		expect(await main(path, counter(), out, err)).toBe(0);
		expect(await main(path, counter(), out, err)).toBe(0);
		expect([out.text, err.text]).toEqual(['Generated DB_PASSWORD, SECRET in dev/.env\n', '']);
	});

	it('sem o arquivo, diz no terminal o que fazer e termina com erro', async () => {
		const path = await envFile();
		const [out, err] = [terminal(), terminal()];

		expect(await main(path, counter(), out, err)).toBe(1);
		expect([out.text, err.text]).toEqual(['', 'dev/.env is missing: copy dev/.env.example to dev/.env\n']);
	});

	it('cada segredo novo tem 32 bytes aleatórios, em hexadecimal', () => {
		const secret = newSecret();

		expect(secret).toMatch(/^[0-9a-f]{64}$/);
		expect(newSecret()).not.toBe(secret);
	});

	it('o .env.example deixa todo segredo vazio, para nenhum ir para o repositório', async () => {
		const example = await readFile(new URL('.env.example', import.meta.url), 'utf8');

		expect(fillSecrets(example, counter()).filled).toEqual(['DB_PASSWORD', 'SECRET', 'ADMIN_PASSWORD', 'ADMIN_TOKEN']);
		expect(example).not.toMatch(/^(DB_PASSWORD|SECRET|ADMIN_PASSWORD|ADMIN_TOKEN)=./m);
	});
});

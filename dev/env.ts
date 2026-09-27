import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// The secrets of the development environment. dev/.env.example leaves them empty, so none lives in the repository.
const secretNames = ['DB_PASSWORD', 'SECRET', 'ADMIN_PASSWORD', 'ADMIN_TOKEN'];

// 32 random bytes, the least Directus accepts for its SECRET without a warning.
export const newSecret = (): string => randomBytes(32).toString('hex');

// Gives each empty or missing secret a new value, and keeps every other line as it is. A secret that already has a
// value stays, because the database volume and the admin were created with it.
export const fillSecrets = (env: string, generate: () => string): { env: string; filled: string[] } => {
	const filled: string[] = [];
	let result = env;

	for (const name of secretNames) {
		const line = new RegExp(`^${name}=(.*)$`, 'm');
		const match = line.exec(result);

		if (match?.[1]?.trim()) {
			continue;
		}

		const secret = `${name}=${generate()}`;

		result = match
			? result.replace(line, () => secret)
			: `${result}${result === '' || result.endsWith('\n') ? '' : '\n'}${secret}\n`;

		filled.push(name);
	}

	return { env: result, filled };
};

// Fills the secrets of the .env file in place, and returns the names of the ones it generated.
export const prepareEnv = async (path: string | URL, generate: () => string): Promise<string[]> => {
	const env = await readFile(path, 'utf8').catch((error: unknown) => {
		throw new Error('dev/.env is missing: copy dev/.env.example to dev/.env', { cause: error });
	});

	const { env: filledEnv, filled } = fillSecrets(env, generate);

	if (filled.length > 0) {
		await writeFile(path, filledEnv);
	}

	return filled;
};

// Where the script writes: the terminal when it runs, a string in the tests.
export interface Output {
	write: (text: string) => unknown;
}

// Prepares the .env file and says what it did, and returns the exit code. A failure prints only its message.
export const main = async (path: string | URL, generate: () => string, out: Output, err: Output): Promise<number> => {
	try {
		const filled = await prepareEnv(path, generate);

		if (filled.length > 0) {
			out.write(`Generated ${filled.join(', ')} in dev/.env\n`);
		}

		return 0;
	} catch (error) {
		err.write(`${error instanceof Error ? error.message : String(error)}\n`);

		return 1;
	}
};

// pnpm dev runs this file with Node, which strips the types, before it starts the containers.
if (import.meta.main) {
	process.exitCode = await main(new URL('.env', import.meta.url), newSecret, process.stdout, process.stderr);
}

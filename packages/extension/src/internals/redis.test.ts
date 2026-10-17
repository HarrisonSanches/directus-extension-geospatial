import { describe, expect, it } from 'vitest';
import { redisOf } from './redis.js';

// The client of Redis as ioredis gives it, with the part the registry reads.
const client = { status: 'ready', eval: () => Promise.resolve(null) };

// The module redis/index of the running Directus (V-188), with the answers of its functions.
const moduleWith = (available: boolean, used: unknown = client) => ({
	createRedis: () => used,
	useRedis: () => used,
	redisConfigAvailable: () => available,
});

const loggerOf = () => {
	const logged: { level: 'warn' | 'info'; first: unknown; message?: unknown }[] = [];

	return {
		logged,
		logger: {
			warn: (first: unknown, message?: unknown) => {
				logged.push({ level: 'warn', first, message });
			},
			info: (first: unknown, message?: unknown) => {
				logged.push({ level: 'info', first, message });
			},
		},
	};
};

// What the log said, by level, with the message apart from the cause.
const said = (logged: { level: string; first: unknown; message?: unknown }[]) =>
	logged.map(({ level, first, message }) => `${level}: ${String(message ?? first)}`);

describe('o Redis do Directus (V-188)', () => {
	it('quando o Directus usa o Redis, a extensão recebe o cliente dele, e o log diz', async () => {
		const { logger, logged } = loggerOf();

		expect(await redisOf(logger, () => Promise.resolve(moduleWith(true)))).toBe(client);
		expect(said(logged)).toEqual([expect.stringMatching(/^info: Directus uses Redis/)]);
	});

	it('quando o Directus não usa o Redis, não há cliente, e o log não avisa nada', async () => {
		const { logger, logged } = loggerOf();
		let used = false;
		const module = {
			...moduleWith(false),
			useRedis: () => {
				used = true;

				return client;
			},
		};

		expect(await redisOf(logger, () => Promise.resolve(module))).toBeUndefined();
		// Asking for the client would connect to a Redis Directus does not use.
		expect(used).toBe(false);
		expect(logged).toEqual([]);
	});

	it.each([
		[
			'o módulo fora do lugar',
			() => Promise.reject(Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' })),
		],
		['um módulo que não é um objeto', () => Promise.resolve(undefined)],
		['o módulo sem as funções', () => Promise.resolve({ createRedis: () => client })],
		[
			'uma função com parâmetros',
			() => Promise.resolve({ ...moduleWith(true), useRedis: (name: string) => (name === '' ? client : client) }),
		],
		['um cliente sem o eval', () => Promise.resolve(moduleWith(true, { status: 'ready' }))],
		['um cliente sem o estado da conexão', () => Promise.resolve(moduleWith(true, { eval: client.eval }))],
	])('%s deixa o registro na memória, com um aviso no log', async (_, load) => {
		const { logger, logged } = loggerOf();

		expect(await redisOf(logger, load)).toBeUndefined();
		expect(said(logged)).toEqual([expect.stringMatching(/^warn: .*memory/)]);
		expect(logged[0]?.first).toBeInstanceOf(Error);
	});

	it('fora de um Directus, o import do módulo falha, e o registro fica na memória', async () => {
		const { logger, logged } = loggerOf();

		// Only the running Directus has @directus/api, which the repository declares and does not install (V-141).
		expect(await redisOf(logger)).toBeUndefined();
		expect(said(logged)).toEqual([expect.stringMatching(/^warn: .*memory/)]);
	});
});

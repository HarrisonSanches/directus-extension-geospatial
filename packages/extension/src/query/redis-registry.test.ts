import type { RegisteredQuery } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import type { RedisClient } from '../internals/redis.js';
import { sharedOn } from './redis-registry.js';

const question: RegisteredQuery = {
	collection: 'occurrences',
	geo: { operation: 'radius', center: [-46.7, -23.65], distance: 1000 },
	query: { search: 'car' },
};

// A client of Redis that keeps the scripts it gets, and answers what the test gives it. The scripts themselves run on a
// Redis in the integration suite (test/redis.test.ts).
const clientAnswering = (answer: unknown) => {
	const calls: unknown[][] = [];
	const client: RedisClient & { status: string } = {
		status: 'ready',
		eval: (...args) => {
			calls.push(args);

			return Promise.resolve(answer);
		},
	};

	return { client, calls };
};

const options = { retention: 24 * 60 * 60 * 1000, bytes: 32 * 1024 * 1024, now: () => 1_000 };

describe('o registro no Redis', () => {
	it('sem o Redis do Directus, não há registro dividido', async () => {
		expect(await sharedOn(Promise.resolve(undefined), options)).toBeUndefined();
	});

	it('registra a pergunta em JSON, sob o prefixo da extensão, com o relógio, o prazo e o teto', async () => {
		const { client, calls } = clientAnswering('OK');
		const shared = await sharedOn(Promise.resolve(client), options);

		await shared?.put('a', question);

		expect(calls.map((call) => call.slice(1))).toEqual([
			[1, 'geospatial:registry:', 'a', JSON.stringify(question), 1_000, options.retention, options.bytes],
		]);
		expect(calls[0]?.[0]).toContain("'SET'");
	});

	it('lê a pergunta de um id, e nada quando o Redis não a tem', async () => {
		const found = clientAnswering(JSON.stringify(question));
		const missing = clientAnswering(null);

		expect(await (await sharedOn(Promise.resolve(found.client), options))?.get('a')).toEqual(question);
		expect(found.calls.map((call) => call.slice(1))).toEqual([
			[1, 'geospatial:registry:', 'a', 1_000, options.retention],
		]);
		expect(await (await sharedOn(Promise.resolve(missing.client), options))?.get('a')).toBeUndefined();
	});

	it('diz que está pronto só com a conexão do cliente no ready', async () => {
		const { client } = clientAnswering(null);
		const shared = await sharedOn(Promise.resolve(client), options);

		expect(shared?.ready()).toBe(true);

		client.status = 'reconnecting';

		expect(shared?.ready()).toBe(false);
	});
});

import type { Readable } from 'node:stream';
import { createItems, customEndpoint } from '@directus/sdk';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { bringBack, takeDown } from './containers.ts';
import { type Client, connect } from './directus.ts';
import { type Environment, startEnvironment } from './environment.ts';
import { circle, createOccurrences, occurrences } from './seed.ts';
import type { Item } from 'directus-geospatial-contract';

const combination = inject('combination');

// A question of the radius, which a few meters more in the distance tell apart from the others, and a search, when the
// test needs a question of a given size.
const questionOf = (apart: number, search?: string) => ({
	collection: 'occurrences',
	geo: { operation: 'radius', center: circle.center, distance: circle.meters + apart },
	query: { fields: ['id', 'region'], ...(search !== undefined && { search }) },
});

const registered = async (client: Client, question: ReturnType<typeof questionOf>) =>
	(
		await client.request(
			customEndpoint<{ id: string }>({ path: '/geospatial/queries', method: 'POST', body: JSON.stringify(question) }),
		)
	).id;

const itemsOf = (client: Client, id: string) =>
	client.request(customEndpoint<Item[]>({ path: `/geospatial/queries/${id}/items`, method: 'GET' }));

// The code of the error a request fails with, in the format of Directus, which the request has to fail with.
const errorCodeOf = async (request: Promise<unknown>): Promise<unknown> => {
	try {
		await request;
	} catch (error) {
		return (error as { errors?: { extensions?: { code?: unknown } }[] }).errors?.[0]?.extensions?.code;
	}

	throw new Error('The request did not fail.');
};

// Runs redis-cli inside the container of Redis, and returns what it printed.
const redisCli = async (redis: StartedTestContainer, ...command: string[]) => {
	const { stdout, output, exitCode } = await redis.exec(['redis-cli', ...command]);

	if (exitCode !== 0) {
		throw new Error(`redis-cli ${command.join(' ')} failed: ${output}`);
	}

	return stdout.trim();
};

const questionKey = (id: string) => `geospatial:registry:question:${id}`;

// The log of a Directus since it started, as Docker keeps it.
const followLog = async (directus: StartedTestContainer) => {
	const log = { text: '', stream: undefined as Readable | undefined };

	log.stream = await directus.logs();
	log.stream.on('data', (chunk: Buffer) => {
		log.text += chunk.toString();
	});

	return log;
};

// Two instances of Directus on the same database and the same Redis, as an installation that scales (§7.8). Only a
// database in a container of its own takes another Directus, and the test starts its own, so the other tests of the
// combination keep theirs. Once with each Directus version, on PostGIS.
describe.runIf(combinations[combination].database.client === 'postgres')(
	'o registro das consultas no Redis, e o Redis fora do ar (§7.8, D-057)',
	() => {
		let environment: Environment | undefined;
		let urls: [string, string] = ['', ''];
		const logs: Awaited<ReturnType<typeof followLog>>[] = [];

		const started = () => {
			const redis = environment?.redis;

			if (environment === undefined || redis === undefined) {
				throw new Error('The Directus of the test did not start.');
			}

			return { ...environment, redis };
		};

		const instance = (index: 0 | 1) => connect(urls[index], started().admin.token);

		beforeAll(async () => {
			environment = await startEnvironment(combination, inject('coverage'), {
				name: `${combination}-redis`,
				redis: true,
			});

			const another = await environment.another();

			urls = [environment.url, `http://${another.getHost()}:${String(another.getMappedPort(8055))}`];
			logs.push(await followLog(environment.directus), await followLog(another));

			await createOccurrences(instance(0), 'occurrences');
			await instance(0).request(createItems('occurrences', occurrences));
		}, 300_000);

		afterAll(async () => {
			for (const { stream } of logs) {
				stream?.destroy();
			}

			await environment?.stop();
		}, 120_000);

		it('um id registrado numa instância é lido na outra, que nunca o registrou', async () => {
			const id = await registered(instance(0), questionOf(1));
			const items = await itemsOf(instance(1), id);

			expect(items.length).toBeGreaterThan(0);
			expect(await itemsOf(instance(0), id)).toEqual(items);
			// Each instance said where the registry is, when it loaded.
			expect(logs.map(({ text }) => text.includes('Directus uses Redis, and the registered queries go to it'))).toEqual(
				[true, true],
			);
		});

		it('a pergunta fica no Redis com o prazo de 24 h, que cada uso renova, e sai dele na hora em que vence', async () => {
			const { redis } = started();
			const id = await registered(instance(0), questionOf(2));
			const day = 24 * 60 * 60 * 1000;

			// A question close to its time, which a read on the other instance renews.
			await redisCli(redis, 'PEXPIRE', questionKey(id), '1000');
			await itemsOf(instance(1), id);

			const renewed = Number(await redisCli(redis, 'PTTL', questionKey(id)));

			expect(renewed).toBeGreaterThan(day - 60_000);
			expect(renewed).toBeLessThanOrEqual(day);

			// Its time come, Redis takes it out by itself, with no request of the extension.
			await redisCli(redis, 'PEXPIRE', questionKey(id), '100');
			await expect.poll(() => redisCli(redis, 'EXISTS', questionKey(id)), { timeout: 5000, interval: 100 }).toBe('0');
			expect(await errorCodeOf(itemsOf(instance(0), id))).toBe('GEOSPATIAL_UNKNOWN_QUERY');
		});

		it(
			'acima de 32 MB, somadas as duas instâncias, sai primeiro a pergunta usada há mais tempo',
			{ timeout: 120_000 },
			async () => {
				const { redis } = started();
				const ceiling = 32 * 1024 * 1024;
				// About 250 KB each, under the 256 KB of a body, so 135 go past the ceiling.
				const ids: string[] = [];

				for (let index = 0; index < 140; index += 1) {
					const search = `${String(index).padStart(3, '0')}${'x'.repeat(250_000)}`;

					ids.push(await registered(instance(index % 2 === 0 ? 0 : 1), questionOf(0, search)));
				}

				expect(Number(await redisCli(redis, 'GET', 'geospatial:registry:held'))).toBeLessThanOrEqual(ceiling);
				expect(await redisCli(redis, 'EXISTS', questionKey(ids[0] ?? ''))).toBe('0');
				expect(await redisCli(redis, 'EXISTS', questionKey(ids.at(-1) ?? ''))).toBe('1');
				expect(Number(await redisCli(redis, 'ZCARD', 'geospatial:registry:used'))).toBeLessThan(ids.length);
			},
		);

		it(
			'com o Redis fora, registrar e ler seguem na memória da instância, sem erro para quem pede, e o log avisa',
			{ timeout: 120_000 },
			async () => {
				const { redis } = started();

				await takeDown(redis);

				// The instance that registers answers from its memory, with no wait for the queue of the client of Redis, which
				// gives up after 10.5 s (V-188). The other instance is left out: Directus itself answers it with a 500, after
				// that queue, when the access of whoever asks is not in its own memory (V-188).
				const startedAt = Date.now();
				const id = await registered(instance(0), questionOf(3));

				expect((await itemsOf(instance(0), id)).length).toBeGreaterThan(0);
				expect(Date.now() - startedAt).toBeLessThan(5000);
				expect(logs[0]?.text).toContain(
					'Redis did not answer, so the registered queries go to the memory of this instance',
				);
			},
		);

		it(
			'com o Redis de volta, ele volta a ser usado, e o id da queda segue valendo na instância que o registrou',
			{ timeout: 120_000 },
			async () => {
				const { redis } = started();
				const down = await registered(instance(0), questionOf(3));

				await bringBack(redis, ['redis-cli', 'ping']);

				// The client of Directus connects again within its retries, of up to 2 s each (V-188).
				await expect
					.poll(
						async () => {
							const id = await registered(instance(0), questionOf(4));

							return (await itemsOf(instance(1), id).catch(() => [])).length;
						},
						{ timeout: 60_000, interval: 1000 },
					)
					.toBeGreaterThan(0);
				expect((await itemsOf(instance(0), down)).length).toBeGreaterThan(0);
				expect(logs[0]?.text).toContain('Redis answers again, and the registered queries go back to it');
			},
		);
	},
);

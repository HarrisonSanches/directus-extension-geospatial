import type { RegisteredQuery } from 'directus-geospatial-contract';
import { describe, expect, it } from 'vitest';
import { fallbackRegistry, type Shared } from './fallback.js';
import { memoryRegistry } from './registry.js';

const minute = 60 * 1000;
const hour = 60 * minute;

const questionOf = (search: string): RegisteredQuery => ({
	collection: 'occurrences',
	geo: { operation: 'radius', center: [-46.7, -23.65], distance: 1000 },
	query: { search },
});

// The registry every instance shares, over a Map, the way Redis keeps the questions. The test takes it down in three
// ways: not connected, a command that fails, and a command that never answers.
const sharedRegistry = () => {
	const entries = new Map<string, RegisteredQuery>();
	const state: { ready: boolean; failure?: Error; hangs: boolean } = { ready: true, hangs: false };
	const commands: string[] = [];

	const answer = <T>(run: () => T): Promise<T> => {
		if (state.failure !== undefined) {
			return Promise.reject(state.failure);
		}

		return state.hangs ? new Promise<T>(() => undefined) : Promise.resolve(run());
	};

	const shared: Shared = {
		ready: () => state.ready,
		put: (id, question) => {
			commands.push(`put ${id}`);

			return answer(() => {
				entries.set(id, question);
			});
		},
		get: (id) => {
			commands.push(`get ${id}`);

			return answer(() => entries.get(id));
		},
	};

	return { shared, entries, state, commands };
};

// A clock the test moves by hand, with the timers it fires when their time comes, and which a cancel takes out.
const fakeClock = () => {
	let time = 0;
	const timers = new Set<{ at: number; run: () => void }>();

	return {
		now: () => time,
		after: (ms: number, run: () => void) => {
			const timer = { at: time + ms, run };

			timers.add(timer);

			return () => {
				timers.delete(timer);
			};
		},
		advance: (ms: number) => {
			time += ms;

			for (const timer of [...timers].filter(({ at }) => at <= time)) {
				timers.delete(timer);
				timer.run();
			}
		},
		pending: () => timers.size,
	};
};

const settled = () => new Promise((resolve) => setImmediate(resolve));

// An instance of Directus: the registry that falls back to its memory, over the shared one, or over none, without Redis.
const instanceOn = (shared: Shared | undefined, clock = fakeClock()) => {
	const logged: { level: 'warn' | 'info'; first: unknown; message?: unknown }[] = [];
	const memory = memoryRegistry({
		retention: 24 * hour,
		bytes: 1024 * 1024,
		sweep: minute,
		now: clock.now,
		every: () => undefined,
	});
	const registry = fallbackRegistry({
		shared: Promise.resolve(shared),
		memory,
		answer: 1000,
		after: clock.after,
		logger: {
			warn: (first: unknown, message?: unknown) => {
				logged.push({ level: 'warn', first, message });
			},
			info: (first: unknown, message?: unknown) => {
				logged.push({ level: 'info', first, message });
			},
		},
	});

	return { registry, memory, clock, logged };
};

// What the log said, by level, with the message apart from the cause.
const said = (logged: { level: string; first: unknown; message?: unknown }[]) =>
	logged.map(({ level, first, message }) => `${level}: ${String(message ?? first)}`);

describe('o registro com o Redis, e o Redis fora do ar (§7.8)', () => {
	it('sem o Redis, a pergunta fica na memória da instância, sem aviso no log', async () => {
		const { registry, memory, logged } = instanceOn(undefined);

		await registry.put('a', questionOf('car'));

		expect(await registry.get('a')).toEqual(questionOf('car'));
		expect(memory.held()).toBeGreaterThan(0);
		expect(logged).toEqual([]);
	});

	it('com o Redis, a pergunta vai para ele, e outra instância lê o id', async () => {
		const { shared, entries } = sharedRegistry();
		const one = instanceOn(shared);
		const another = instanceOn(shared);

		await one.registry.put('a', questionOf('car'));

		expect(await another.registry.get('a')).toEqual(questionOf('car'));
		expect(entries.get('a')).toEqual(questionOf('car'));
		expect([one.memory.held(), another.memory.held()]).toEqual([0, 0]);
	});

	it('com o Redis desconectado, o registro e a leitura vão para a memória na hora, sem comando, e o log avisa uma vez', async () => {
		const { shared, state, commands } = sharedRegistry();
		const { registry, logged } = instanceOn(shared);

		state.ready = false;
		await registry.put('a', questionOf('car'));

		expect(await registry.get('a')).toEqual(questionOf('car'));
		expect(commands).toEqual([]);
		expect(said(logged)).toEqual([expect.stringMatching(/^warn: .*memory/)]);
		expect(logged[0]?.first).toBeInstanceOf(Error);
	});

	it('um comando que falha cai para a memória, com a causa no log', async () => {
		const { shared, state } = sharedRegistry();
		const { registry, logged } = instanceOn(shared);
		const failure = new Error('Reached the max retries per request limit (which is 20)');

		state.failure = failure;
		await registry.put('a', questionOf('car'));

		expect(await registry.get('a')).toEqual(questionOf('car'));
		expect(said(logged)).toEqual([expect.stringMatching(/^warn: .*memory/)]);
		expect(logged.map(({ first }) => first)).toEqual([failure]);
	});

	it('um comando sem resposta cai para a memória quando o tempo máximo vence, e não antes', async () => {
		const { shared, state } = sharedRegistry();
		const { registry, clock, logged } = instanceOn(shared);
		let registered = false;

		state.hangs = true;
		void registry.put('a', questionOf('car')).then(() => {
			registered = true;
		});
		await settled();
		clock.advance(999);
		await settled();

		expect(registered).toBe(false);

		clock.advance(1);
		await settled();

		expect(registered).toBe(true);
		expect(logged).toHaveLength(1);

		const reading = registry.get('a');

		await settled();
		clock.advance(1000);

		expect(await reading).toEqual(questionOf('car'));
	});

	it('o tempo máximo de um comando que respondeu sai, sem disparar depois', async () => {
		const { shared } = sharedRegistry();
		const { registry, clock, logged } = instanceOn(shared);

		await registry.put('a', questionOf('car'));
		await registry.get('a');

		expect(clock.pending()).toBe(0);

		clock.advance(1000);

		expect(logged).toEqual([]);
	});

	it('com o Redis de volta, ele volta a ser usado, e o log diz uma vez', async () => {
		const { shared, state, entries } = sharedRegistry();
		const { registry, logged } = instanceOn(shared);

		state.ready = false;
		await registry.put('a', questionOf('car'));
		state.ready = true;
		await registry.put('b', questionOf('bus'));
		await registry.put('c', questionOf('van'));

		expect([...entries.keys()]).toEqual(['b', 'c']);
		expect(logged.map(({ level }) => level)).toEqual(['warn', 'info']);
	});

	it('um id registrado durante a queda segue valendo naquela instância depois que o Redis volta', async () => {
		const { shared, state } = sharedRegistry();
		const { registry } = instanceOn(shared);

		state.ready = false;
		await registry.put('a', questionOf('car'));
		state.ready = true;

		expect(await registry.get('a')).toEqual(questionOf('car'));
		expect(await registry.get('b')).toBeUndefined();
	});
});

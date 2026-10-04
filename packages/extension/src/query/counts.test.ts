import { describe, expect, it } from 'vitest';
import { memoryCounts } from './counts.js';

// A clock the test moves by hand, with the timers it fires when their time comes, so nothing waits for real time.
const fakeClock = () => {
	let time = 0;
	const timers: { at: number; run: () => void }[] = [];

	return {
		now: () => time,
		after: (ms: number, run: () => void) => {
			timers.push({ at: time + ms, run });
		},
		advance: (ms: number) => {
			time += ms;

			for (const timer of timers.filter(({ at }) => at <= time)) {
				timers.splice(timers.indexOf(timer), 1);
				timer.run();
			}
		},
	};
};

// A count the test settles by hand.
const deferredCount = () => {
	const calls: { resolve: (total: number) => void; reject: (error: Error) => void }[] = [];

	return {
		calls,
		count: () =>
			new Promise<number>((resolve, reject) => {
				calls.push({ resolve, reject });
			}),
	};
};

const settled = () => new Promise((resolve) => setImmediate(resolve));

const countsWith = (overrides: { concurrency?: number; entries?: number } = {}) => {
	const clock = fakeClock();
	const logged: unknown[] = [];
	const counts = memoryCounts({
		timeout: 30_000,
		retention: 5 * 60 * 1000,
		concurrency: 2,
		entries: 100,
		now: clock.now,
		after: clock.after,
		logger: { warn: (error: unknown) => logged.push(error) },
		...overrides,
	});

	return { counts, clock, logged };
};

describe('a contagem exata em segundo plano (§7.1)', () => {
	it('começa no primeiro pedido, e um pedido seguinte traz o total, quando ela termina', async () => {
		const { counts } = countsWith();
		const { calls, count } = deferredCount();

		expect(counts.exactOf('a', count)).toEqual({ state: 'counting' });
		expect(counts.exactOf('a', count)).toEqual({ state: 'counting' });
		expect(calls).toHaveLength(1);

		calls[0]?.resolve(512_340);
		await settled();

		expect(counts.exactOf('a', count)).toEqual({ state: 'counted', total: 512_340 });
		expect(calls).toHaveLength(1);
	});

	it('passado o tempo máximo, desiste, e um total que chega depois não muda isso', async () => {
		const { counts, clock } = countsWith();
		const { calls, count } = deferredCount();

		counts.exactOf('a', count);
		clock.advance(29_999);

		expect(counts.exactOf('a', count)).toEqual({ state: 'counting' });

		clock.advance(1);

		expect(counts.exactOf('a', count)).toEqual({ state: 'given up' });

		calls[0]?.resolve(512_340);
		await settled();

		expect(counts.exactOf('a', count)).toEqual({ state: 'given up' });
		expect(calls).toHaveLength(1);
	});

	it('uma contagem que falha vai para o log como aviso, e desiste', async () => {
		const { counts, logged } = countsWith();
		const { calls, count } = deferredCount();
		const failure = new Error('canceling statement due to statement timeout');

		counts.exactOf('a', count);
		calls[0]?.reject(failure);
		await settled();

		expect(counts.exactOf('a', count)).toEqual({ state: 'given up' });
		expect(logged).toEqual([failure]);
	});

	it('o total e a desistência valem pela retenção, e depois a contagem roda de novo', async () => {
		const { counts, clock } = countsWith();
		const { calls, count } = deferredCount();

		counts.exactOf('a', count);
		calls[0]?.resolve(512_340);
		await settled();
		clock.advance(5 * 60 * 1000 - 1);

		expect(counts.exactOf('a', count)).toEqual({ state: 'counted', total: 512_340 });

		clock.advance(1);

		expect(counts.exactOf('a', count)).toEqual({ state: 'counting' });
		expect(calls).toHaveLength(2);
	});

	it('cada chave conta à parte, e o total de uma nunca responde pela outra', async () => {
		const { counts } = countsWith();
		const { calls, count } = deferredCount();

		counts.exactOf('maria', count);
		counts.exactOf('admin', count);
		calls[0]?.resolve(12_000);
		calls[1]?.resolve(15_000);
		await settled();

		expect(counts.exactOf('maria', count)).toEqual({ state: 'counted', total: 12_000 });
		expect(counts.exactOf('admin', count)).toEqual({ state: 'counted', total: 15_000 });
	});

	it('roda no máximo duas ao mesmo tempo, e a terceira começa num pedido depois que uma termina', async () => {
		const { counts } = countsWith();
		const { calls, count } = deferredCount();

		counts.exactOf('a', count);
		counts.exactOf('b', count);

		expect(counts.exactOf('c', count)).toEqual({ state: 'counting' });
		expect(calls).toHaveLength(2);

		calls[0]?.resolve(1);
		await settled();

		expect(calls).toHaveLength(2);
		expect(counts.exactOf('c', count)).toEqual({ state: 'counting' });
		expect(calls).toHaveLength(3);
	});

	it('uma contagem que desistiu pelo tempo segura a vaga até o banco responder', async () => {
		const { counts, clock } = countsWith({ concurrency: 1 });
		const { calls, count } = deferredCount();

		counts.exactOf('a', count);
		clock.advance(30_000);
		counts.exactOf('b', count);

		expect(calls).toHaveLength(1);

		calls[0]?.reject(new Error('canceled'));
		await settled();
		counts.exactOf('b', count);

		expect(calls).toHaveLength(2);
	});

	it('uma contagem em andamento não sai pelo teto de chaves, e o total dela fica quando ela termina', async () => {
		const { counts } = countsWith({ entries: 1 });
		const { calls, count } = deferredCount();

		counts.exactOf('a', count);
		counts.exactOf('b', count);
		calls[0]?.resolve(1);
		await settled();

		expect(counts.exactOf('a', count)).toEqual({ state: 'counted', total: 1 });
		expect(calls).toHaveLength(2);
	});

	it('acima do teto de chaves, a mais antiga sai primeiro', async () => {
		const { counts } = countsWith({ entries: 2 });
		const { calls, count } = deferredCount();

		for (const key of ['a', 'b', 'c']) {
			counts.exactOf(key, count);
			calls.at(-1)?.resolve(1);
			await settled();
		}

		expect(counts.exactOf('b', count)).toEqual({ state: 'counted', total: 1 });
		expect(counts.exactOf('c', count)).toEqual({ state: 'counted', total: 1 });
		expect(counts.exactOf('a', count)).toEqual({ state: 'counting' });
	});
});

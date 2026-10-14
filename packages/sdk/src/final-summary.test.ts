import type { SummaryValues } from 'directus-geospatial-contract';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isGeospatialError } from './errors.js';
import { type Answer, fakeClient } from './fake-fetch.js';
import { finalSummaryWith, geoFinalSummary } from './final-summary.js';

const id = 'AAAAAAAAAAAAAAAAAAAAAA';

const counting: SummaryValues = { total: 10_000, exact: false, counting: true };
const exact: SummaryValues = { total: 15_000, exact: true, counting: false };

const answer = (summary: SummaryValues): Answer => ({ body: { data: summary } });

// A clock that only moves when the wait sleeps, and keeps each sleep.
const fakeClock = () => {
	let time = 0;
	const sleeps: number[] = [];

	return {
		sleeps,
		clock: {
			now: () => time,
			sleep: (ms: number) => {
				sleeps.push(ms);
				time += ms;

				return Promise.resolve();
			},
		},
	};
};

describe('geoFinalSummary()', () => {
	it('com o total exato, ou sem contagem em segundo plano, devolve o primeiro resumo, sem esperar', async () => {
		const { clock, sleeps } = fakeClock();
		const { client, requests } = fakeClient(answer(exact));
		const summary = await finalSummaryWith(clock)(client, id);

		expect(summary).toEqual(exact);
		expectTypeOf(summary).toEqualTypeOf<SummaryValues>();
		expect(requests).toHaveLength(1);
		expect(sleeps).toEqual([]);
	});

	it('enquanto a contagem exata roda, pede de novo a cada intervalo, e devolve o total quando ele chega (§7.1)', async () => {
		const { clock, sleeps } = fakeClock();
		const { client, requests } = fakeClient([answer(counting), answer(counting), answer(exact)]);

		expect(await finalSummaryWith(clock)(client, id, { interval: 2000 })).toEqual(exact);
		expect(sleeps).toEqual([2000, 2000]);
		expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(
			Array.from({ length: 3 }, () => `/geospatial/queries/${id}/summary`),
		);
	});

	it('a contagem que passou do tempo máximo dela termina sem o total exato, e o resumo sai assim', async () => {
		const { clock } = fakeClock();
		const gaveUp: SummaryValues = { total: 10_000, exact: false, counting: false };
		const { client } = fakeClient([answer(counting), answer(gaveUp)]);

		expect(await finalSummaryWith(clock)(client, id)).toEqual(gaveUp);
	});

	it('no tempo máximo, devolve o último resumo, ainda contando, sem passar dele: por padrão, 1 s de intervalo e 30 s', async () => {
		const { clock, sleeps } = fakeClock();
		const { client, requests } = fakeClient(Array.from({ length: 40 }, () => answer(counting)));

		expect(await finalSummaryWith(clock)(client, id)).toEqual(counting);
		expect(sleeps).toEqual(Array.from({ length: 30 }, () => 1000));
		expect(requests).toHaveLength(31);

		const short = fakeClock();
		const asked = fakeClient(Array.from({ length: 5 }, () => answer(counting)));

		await finalSummaryWith(short.clock)(asked.client, id, { interval: 1000, timeout: 2500 });

		expect(short.sleeps).toEqual([1000, 1000]);
		expect(asked.requests).toHaveLength(3);
	});

	it('um erro, como o id que o Directus esqueceu, chega tipado, sem esperar mais', async () => {
		const { clock, sleeps } = fakeClock();
		const { client } = fakeClient([
			answer(counting),
			{
				status: 404,
				body: { errors: [{ message: 'Unknown query.', extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }] },
			},
		]);
		const error: unknown = await finalSummaryWith(clock)(client, id).catch((thrown: unknown) => thrown);

		expect(isGeospatialError(error, 'GEOSPATIAL_UNKNOWN_QUERY')).toBe(true);
		expect(sleeps).toEqual([1000]);
	});

	it('o geoFinalSummary() espera pelo relógio de verdade', async () => {
		const { client, requests } = fakeClient([answer(counting), answer(exact)]);

		expect(await geoFinalSummary(client, id, { interval: 1 })).toEqual(exact);
		expect(requests).toHaveLength(2);
	});
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pinnedNow } from './now.js';

// date-fns moves days, weeks, months and years in the local time of the process, as Directus does, whose image runs in
// UTC. The test runs there too, so an adjustment across a change of summer time in the zone of the machine stays put.
beforeAll(() => {
	vi.stubEnv('TZ', 'UTC');
});

afterAll(() => {
	vi.unstubAllEnvs();
});

// The registration, at 14:37:42.500 of 3 October 2026, in UTC.
const registeredAt = Date.UTC(2026, 9, 3, 14, 37, 42, 500);

describe('o $NOW do filtro, no registro', () => {
	it('vira o minuto do registro, em ISO 8601, como o Directus compara uma data (V-182)', () => {
		expect(pinnedNow({ occurred_at: { _lte: '$NOW' } }, registeredAt)).toEqual({
			occurred_at: { _lte: '2026-10-03T14:37:00.000Z' },
		});
	});

	it('dois registros no mesmo minuto dão o mesmo instante, e o minuto seguinte, outro', () => {
		const filter = { occurred_at: { _gte: '$NOW(-7 days)' } };

		expect(pinnedNow(filter, Date.UTC(2026, 9, 3, 14, 37, 0))).toEqual(pinnedNow(filter, registeredAt));
		expect(pinnedNow(filter, Date.UTC(2026, 9, 3, 14, 37, 59, 999))).toEqual(pinnedNow(filter, registeredAt));
		expect(pinnedNow(filter, Date.UTC(2026, 9, 3, 14, 38))).not.toEqual(pinnedNow(filter, registeredAt));
	});

	it.each([
		['$NOW(-7 days)', '2026-09-26T14:37:00.000Z'],
		['$NOW(+1 month)', '2026-11-03T14:37:00.000Z'],
		['$NOW(-90 minutes)', '2026-10-03T13:07:00.000Z'],
		['$NOW(2 h)', '2026-10-03T16:37:00.000Z'],
		['$NOW(+1.5 hours)', '2026-10-03T16:07:00.000Z'],
		['$NOW(-1 y)', '2025-10-03T14:37:00.000Z'],
		['$NOW(3mo)', '2027-01-03T14:37:00.000Z'],
		['$NOW(-2 W)', '2026-09-19T14:37:00.000Z'],
		['$NOW(30 secs)', '2026-10-03T14:37:30.000Z'],
		['$NOW(-500 ms)', '2026-10-03T14:36:59.500Z'],
		// Without a unit, the amount is in days, and a second minus turns the subtraction into an addition.
		['$NOW(5)', '2026-10-08T14:37:00.000Z'],
		['$NOW(--1 day)', '2026-10-04T14:37:00.000Z'],
		// Directus takes an adjustment it cannot read as no adjustment at all.
		['$NOW(yesterday)', '2026-10-03T14:37:00.000Z'],
		['$NOW(1 fortnight)', '2026-10-03T14:37:00.000Z'],
		['$NOW()', '2026-10-03T14:37:00.000Z'],
		['$NOW(-1 day', '2026-10-03T14:37:00.000Z'],
		['$NOWADAYS', '2026-10-03T14:37:00.000Z'],
	])('%s se ajusta a partir do minuto do registro, como o adjustDate do Directus', (now, instant) => {
		expect(pinnedNow({ occurred_at: { _gte: now } }, registeredAt)).toEqual({ occurred_at: { _gte: instant } });
	});

	it('um ajuste com milhares de dígitos, que nunca vale, deixa o minuto do registro, e sai logo', () => {
		const startedAt = performance.now();

		expect(pinnedNow({ occurred_at: { _gte: `$NOW(${'1'.repeat(200_000)}!)` } }, registeredAt)).toEqual({
			occurred_at: { _gte: '2026-10-03T14:37:00.000Z' },
		});
		expect(performance.now() - startedAt).toBeLessThan(100);
	});

	it.each([
		['.5 h', '2026-10-03T15:07:00.000Z'],
		['-.5 h', '2026-10-03T14:07:00.000Z'],
		['1.25 minutes', '2026-10-03T14:38:15.000Z'],
		// A number Directus does not read leaves the minute of the registration as it is.
		['5.', '2026-10-03T14:37:00.000Z'],
		['..5', '2026-10-03T14:37:00.000Z'],
		['5..5', '2026-10-03T14:37:00.000Z'],
		['1e3', '2026-10-03T14:37:00.000Z'],
	])('o número de $NOW(%s) se lê como o Directus o lê', (adjustment, instant) => {
		expect(pinnedNow({ occurred_at: { _gte: `$NOW(${adjustment})` } }, registeredAt)).toEqual({
			occurred_at: { _gte: instant },
		});
	});

	it('vale em qualquer lugar do filtro: nas listas, no _and, no _or e num campo de uma relação', () => {
		expect(
			pinnedNow(
				{
					_and: [
						{ occurred_at: { _between: ['$NOW(-1 day)', '$NOW'] } },
						{ _or: [{ owner: { date_created: { _lt: '$NOW' } } }, { status: { _eq: 'open' } }] },
					],
				},
				registeredAt,
			),
		).toEqual({
			_and: [
				{ occurred_at: { _between: ['2026-10-02T14:37:00.000Z', '2026-10-03T14:37:00.000Z'] } },
				{ _or: [{ owner: { date_created: { _lt: '2026-10-03T14:37:00.000Z' } } }, { status: { _eq: 'open' } }] },
			],
		});
	});

	it('deixa o resto como veio: as outras variáveis, que valem para quem pede cada parte, e os outros valores', () => {
		const filter = {
			owner: { _eq: '$CURRENT_USER' },
			region: { _in: ['south', 'north'] },
			count: { _gt: 3 },
			closed: { _null: true },
			note: { _eq: 'before $NOW' },
		};

		expect(pinnedNow(filter, registeredAt)).toEqual(filter);
	});
});

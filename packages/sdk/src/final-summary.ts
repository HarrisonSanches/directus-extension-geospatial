import type { RestClient } from '@directus/sdk';
import type { QueryId, SummaryValues } from 'directus-geospatial-contract';
import { type GeoQuery, geoQuerySummary } from './queries.js';

// How long to wait, in milliseconds: between two requests, and in all.
export interface GeoFinalSummaryOptions {
	readonly interval?: number;
	readonly timeout?: number;
}

// The time, and a wait, injected, so the tests move the clock.
interface Clock {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
}

// The wait of geoFinalSummary(), on a clock of its own. It asks again, after each interval, while the exact count runs
// in the background, and gives the first summary whose counting is false, with the exact total or, past the time
// maximum of the count, without it. A request past the timeout is never sent: at the timeout, it gives the last
// summary, still counting.
export const finalSummaryWith =
	({ now, sleep }: Clock) =>
	async <Schema>(
		client: RestClient<Schema>,
		query: GeoQuery<Schema> | QueryId,
		{ interval = 1000, timeout = 30_000 }: GeoFinalSummaryOptions = {},
	): Promise<SummaryValues> => {
		const until = now() + timeout;
		let summary = await client.request(geoQuerySummary(query));

		while (summary.counting && now() + interval <= until) {
			await sleep(interval);
			summary = await client.request(geoQuerySummary(query));
		}

		return summary;
	};

// The summary of a registered query once it changes no more (§7.1, D-059). Past 10,000 items, the first summary brings
// a floor, and the exact count runs in the background; this waits for it, as a waiter of an SDK does. Each request
// reads the quick count again, so the interval goes by the second, 1 s by default, and the timeout, 30 s by default, is
// the time maximum of the exact count.
export const geoFinalSummary = finalSummaryWith({
	now: () => Date.now(),
	sleep: (ms) =>
		new Promise((resolve) => {
			setTimeout(resolve, ms);
		}),
});

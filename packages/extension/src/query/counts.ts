import type { Logger } from 'pino';

// The exact total of a summary, as far as it is known (§7.1): counted, still counting or waiting for its turn, or given
// up, past the time maximum of the count or on an error of the database.
type Exact = { state: 'counted'; total: number } | { state: 'counting' } | { state: 'given up' };

// The exact counts of the summaries, each kept by a key that holds the permissions of whoever asks, so a total only
// ever answers whoever has the same ones (D-006).
export interface Counts {
	// The exact total of a key, as far as it is known, or the count started in the background, where nothing is known
	// and a turn is free.
	exactOf: (key: string, count: () => Promise<number>) => Exact;
}

type Entry = Exclude<Exact, { state: 'counting' }> & { expires: number };

interface Options {
	// The time maximum of a count, in milliseconds, past which the summary gives up on it.
	timeout: number;
	// How long a total, or a count given up, is kept, in milliseconds, before the count runs again.
	retention: number;
	// The most counts running at a time, each one holding a connection of the database.
	concurrency: number;
	// The most keys kept, past which the oldest ones go first.
	entries: number;
	// The clock, in milliseconds.
	now: () => number;
	// Runs a function once a time in milliseconds passed.
	after: (ms: number, run: () => void) => void;
	// Where a count that gave up goes, a warning: past its time maximum, the count fails as the database cancels it.
	logger: Pick<Logger, 'warn'>;
}

// The exact counts in the memory of the process. A count runs in the background, at most concurrency of them at a time,
// and the summary gives up on it past its time maximum, which the database enforces as well, cancelling the statement
// (banco-e-sql.md). The first of the two to happen stays: a total that comes after the time maximum is not kept. A count
// keeps its turn until the database answers, since it holds a connection until then.
export const memoryCounts = ({
	timeout,
	retention,
	concurrency,
	entries: most,
	now,
	after,
	logger,
}: Options): Counts => {
	const entries = new Map<string, Entry | { state: 'counting' }>();
	let running = 0;

	// What is past its retention leaves the memory at the next request, and the count runs again.
	const sweep = (at: number) => {
		for (const [key, entry] of entries) {
			if (entry.state !== 'counting' && entry.expires <= at) {
				entries.delete(key);
			}
		}
	};

	// The end of a count, unless it already ended. The entry goes last, in the order the oldest ones leave in.
	const settle = (key: string, job: object, entry: Entry) => {
		if (entries.get(key) === job) {
			entries.delete(key);
			entries.set(key, entry);
		}
	};

	const start = (key: string, count: () => Promise<number>) => {
		const job = { state: 'counting' } as const;
		const giveUp = () => {
			settle(key, job, { state: 'given up', expires: now() + retention });
		};

		running += 1;
		entries.set(key, job);

		for (const [oldest, entry] of entries) {
			if (entries.size <= most) {
				break;
			}

			if (entry.state !== 'counting') {
				entries.delete(oldest);
			}
		}

		after(timeout, giveUp);

		// The count starts now, in the background. One that throws before it hands back its promise gives up as one that
		// rejects, and either way the turn is free once the database answered.
		const run = async () => {
			try {
				const total = await count();

				settle(key, job, { state: 'counted', total, expires: now() + retention });
			} catch (error) {
				logger.warn(error, 'The exact count of a summary gave up');
				giveUp();
			} finally {
				running -= 1;
			}
		};

		void run();
	};

	return {
		exactOf: (key, count) => {
			sweep(now());

			const entry = entries.get(key);

			if (entry !== undefined) {
				return entry.state === 'counted' ? { state: entry.state, total: entry.total } : { state: entry.state };
			}

			if (running < concurrency) {
				start(key, count);
			}

			return { state: 'counting' };
		},
	};
};

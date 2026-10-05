import type { RegisteredQuery } from 'directus-geospatial-contract';

// Where the registered queries are kept, by their id (§7.8). The memory is the default, and the Redis of Directus comes
// behind the same interface, which is why each call returns a promise.
export interface Registry {
	// Keeps the question under its id, for the retention from now.
	put: (id: string, question: RegisteredQuery) => Promise<void>;
	// The question of an id, which renews its retention, or undefined, when this Directus does not know the id.
	get: (id: string) => Promise<RegisteredQuery | undefined>;
}

interface Entry {
	question: RegisteredQuery;
	bytes: number;
	expires: number;
}

interface Options {
	// How long an entry is kept since it was last used, in milliseconds (D-038).
	retention: number;
	// The most bytes the questions take, in JSON, past which the least recently used ones go first.
	bytes: number;
	// How often the expired entries leave the memory, in milliseconds, with no request to do it.
	sweep: number;
	// The clock, in milliseconds.
	now: () => number;
	// Runs run every ms milliseconds, for as long as the process runs.
	every: (ms: number, run: () => void) => void;
}

// The registry in memory, with the bytes its questions take now.
export interface MemoryRegistry extends Registry {
	held: () => number;
}

// The registry in the memory of the process, the default, for a Directus without Redis (§7.8). A Directus that restarts
// forgets it, and the client registers again, under the same id. Each entry is kept for the retention since it was last
// used, and past the bytes it holds, the least recently used ones go first (LRU). The expired ones leave at the next
// request, and at most a sweep later in a process with no requests, since a question may hold personal data (D-038).
export const memoryRegistry = ({ retention, bytes, sweep: interval, now, every }: Options): MemoryRegistry => {
	// A Map keeps the order in which its keys went in, and each use puts the entry back at the end, so the first one is
	// the least recently used, and the first to expire.
	const entries = new Map<string, Entry>();
	let held = 0;

	const remove = (id: string) => {
		held -= entries.get(id)?.bytes ?? 0;
		entries.delete(id);
	};

	const keep = (id: string, entry: Entry) => {
		remove(id);
		entries.set(id, entry);
		held += entry.bytes;
	};

	// The expired entries leave the memory at the next request, and do not wait for the ceiling (D-038).
	const sweep = (at: number) => {
		for (const [id, entry] of entries) {
			if (entry.expires > at) {
				return;
			}

			remove(id);
		}
	};

	every(interval, () => {
		sweep(now());
	});

	return {
		held: () => held,
		put: (id, question) => {
			const at = now();

			sweep(at);
			keep(id, { question, bytes: Buffer.byteLength(JSON.stringify(question)), expires: at + retention });

			for (const [oldest] of entries) {
				if (held <= bytes) {
					break;
				}

				remove(oldest);
			}

			return Promise.resolve();
		},
		get: (id) => {
			const at = now();

			sweep(at);

			const entry = entries.get(id);

			// The sweep stops at the first entry still in time, so one that expired behind it, when the clock of the system
			// went back, is checked here.
			if (entry === undefined || entry.expires <= at) {
				return Promise.resolve(undefined);
			}

			keep(id, { ...entry, expires: at + retention });

			return Promise.resolve(entry.question);
		},
	};
};

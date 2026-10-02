import { performance } from 'node:perf_hooks';
import type { Knex } from 'knex';

// The collection the measurements read, whose reads the observer times.
export const collection = 'occurrences';

// A statement as Knex hands it to the driver: the SQL with the positions of its values, and the values.
export interface Statement {
	uid: string;
	sql: string;
	bindings: Knex.Value[];
}

// The last read of the collection: when the hooks of items.query got its page, and when the statement of the radius,
// the one with ST_DWithin, went to the database and came back.
interface Read {
	hookedAt: number;
	statement?: Statement & { sentAt: number; answeredAt?: number };
}

let last: Read | undefined;

// The radius emits items.query once the permitted query starts, and before the chain builds it (V-174).
export const hooked = (): void => {
	last = { hookedAt: performance.now() };
};

// The first statement of the radius after the hooks, which carries the permitted query inside it.
export const sent = (statement: Statement): void => {
	if (last !== undefined && last.statement === undefined && /st_dwithin/i.test(statement.sql)) {
		last.statement = { ...statement, sentAt: performance.now() };
	}
};

export const answered = (uid: string): void => {
	if (last?.statement?.uid === uid) {
		last.statement.answeredAt = performance.now();
	}
};

// The times of the last read, in milliseconds: building the permitted query, from the hooks of items.query to the
// statement of the radius, and the database, from the statement to its answer. Forgotten once handed over, so a read
// that times nothing never hands over the one before it.
export const takeLast = (): { build: number; database: number; statement: Statement } | undefined => {
	const read = last;

	last = undefined;

	if (read?.statement?.answeredAt === undefined) {
		return undefined;
	}

	const { sentAt, answeredAt, ...statement } = read.statement;

	return { build: sentAt - read.hookedAt, database: answeredAt - sentAt, statement };
};

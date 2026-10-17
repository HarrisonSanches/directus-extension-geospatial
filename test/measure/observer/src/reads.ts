import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Knex } from 'knex';

// The collection the measurements read, whose reads the observer hands over when a request names no other.
export const measured = 'occurrences';

// A statement as Knex hands it to the driver: the SQL with the positions of its values, and the values.
export interface Statement {
	uid: string;
	sql: string;
	bindings: Knex.Value[];
}

// The last read of a collection: when the hooks of items.query got its page, and when the statement of the radius, the
// one with ST_DWithin, went to the database and came back.
interface Read {
	hookedAt: number;
	statement?: Statement & { sentAt: number; answeredAt?: number };
}

const last = new Map<string, Read>();

// The radius emits items.query once the permitted query starts, and before the chain builds it (V-174).
export const hooked = (collection: string): void => {
	last.set(collection, { hookedAt: performance.now() });
};

// The first statement of the radius after the hooks of a collection, which carries the permitted query inside it, and
// the permitted query reads the table by its name. The suite reads other collections at the same time.
export const sent = (statement: Statement): void => {
	if (!/st_dwithin/i.test(statement.sql)) {
		return;
	}

	for (const [collection, read] of last) {
		if (read.statement === undefined && statement.sql.includes(`from "${collection}"`)) {
			read.statement = { ...statement, sentAt: performance.now() };

			return;
		}
	}
};

export const answered = (uid: string): void => {
	for (const read of last.values()) {
		if (read.statement?.uid === uid) {
			read.statement.answeredAt = performance.now();
		}
	}
};

// The times of the last read of a collection, in milliseconds: building the permitted query, from the hooks of
// items.query to the statement of the radius, and the database, from the statement to its answer. Forgotten once handed
// over, so a read that times nothing never hands over the one before it.
export const takeLast = (collection: string): { build: number; database: number; statement: Statement } | undefined => {
	const read = last.get(collection);

	last.delete(collection);

	if (read?.statement?.answeredAt === undefined) {
		return undefined;
	}

	const { sentAt, answeredAt, ...statement } = read.statement;

	return { build: sentAt - read.hookedAt, database: answeredAt - sentAt, statement };
};

// The statements of the last transactions of the connection, by the id Knex gives each one, at most 100 of them.
const transactions = new Map<string, Statement[]>();

// Only the first statements of each transaction are kept, where the time maximum and the count are: the pool lends the
// connection of a transaction to every statement after it, under its id, and keeping them all would slow Directus down.
export const inTransaction = (id: string, statement: Statement): void => {
	const statements = transactions.get(id);

	if (statements === undefined) {
		transactions.set(id, [statement]);
	} else if (statements.length < 10) {
		statements.push(statement);
	}

	for (const [oldest] of transactions) {
		if (transactions.size <= 100) {
			break;
		}

		transactions.delete(oldest);
	}
};

// Whether a statement counts every item of a collection, with no limit, as the exact count of a summary does.
const countsAll = (collection: string) => (statement: Statement) =>
	statement.sql.includes('count(*)') &&
	statement.sql.includes(`from "${collection}"`) &&
	!/\blimit\b/i.test(statement.sql);

// The statements of the transaction of the last exact count of a collection, from its first statement to the count,
// forgotten once handed over. Knex keeps the id of a transaction on its connection, which the pool then lends to other
// statements, so a quick count can come under the id of an old transaction. The exact count only runs in a transaction
// of its own, and comes under its id. The begin and the commit carry no id of a statement, and are not seen.
export const takeCount = (collection: string): Statement[] | undefined => {
	const found = [...transactions].reverse().find(([, statements]) => statements.some(countsAll(collection)));

	if (found === undefined) {
		return undefined;
	}

	const [id, statements] = found;

	transactions.delete(id);

	return statements.slice(0, statements.findIndex(countsAll(collection)) + 1);
};

// How late the event loop of Directus ran, sampled every 10 ms, which its pressure limiter reads to answer 503 past
// 500 ms (V-181).
const lag = monitorEventLoopDelay({ resolution: 10 });

lag.enable();

// The longest the event loop ran late since the last read, in milliseconds, forgotten once handed over.
export const takeLag = (): number => {
	const longest = lag.max / 1e6;

	lag.reset();

	return longest;
};

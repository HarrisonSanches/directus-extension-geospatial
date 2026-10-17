import type { Knex } from 'knex';
import type { Key } from './adapter.js';

// A key of the order of a list: what the statement reads it by, its direction, and whether it can be empty, as a field a
// policy holds back. The primary key and the distance never are.
export interface OrderKey {
	column: Knex.Raw;
	direction: 'asc' | 'desc';
	nullable: boolean;
}

// Where a database puts an empty value in its order: Postgres takes it as the largest value, and SQLite as the smallest.
export type Nulls = 'largest' | 'smallest';

type Where = Knex.QueryBuilder;

const sameAs = (where: Where, column: Knex.Raw, value: Key) =>
	value === null ? where.whereRaw('? is null', [column]) : where.whereRaw('? = ?', [column, value]);

// The rows past the last one a page saw, in the order of the keys, which ends with the primary key, so no two rows tie:
// the pagination by key (keyset). The next page starts right after that row, and the database neither returns the rows
// before it nor leaves out a row a write moved, as an offset does. A row is past when it comes after on the first key,
// or is the same on it and comes after on the next one, and so on. An empty value sits where the database puts it, and
// nothing comes after an empty value that comes last.
export const pastKeys = (builder: Where, keys: OrderKey[], values: Key[], nulls: Nulls): void => {
	const [first] = keys;

	// Without keys, as in the natural order the server takes, the statement goes as it was.
	if (first === undefined) {
		return;
	}

	// Keys that are never empty, all in one direction, as the distance and the primary key, compare as rows, which both
	// databases take, and each key is read once, where the chain below would measure the distance again in each branch.
	if (keys.every(({ nullable, direction }) => !nullable && direction === first.direction)) {
		const marks = keys.map(() => '?').join(', ');

		builder.andWhereRaw(`(${marks}) ${first.direction === 'desc' ? '<' : '>'} (${marks})`, [
			...keys.map(({ column }) => column),
			...values,
		]);

		return;
	}

	builder.andWhere((past) => {
		keys.forEach(({ column, direction, nullable }, index) => {
			const value = values[index] ?? null;
			const emptyLast = (nulls === 'largest') === (direction === 'asc');
			const beyond = direction === 'asc' ? '>' : '<';

			if (value === null && emptyLast) {
				return;
			}

			past.orWhere((tier) => {
				for (const [at, before] of keys.slice(0, index).entries()) {
					sameAs(tier, before.column, values[at] ?? null);
				}

				if (value === null) {
					tier.whereRaw('? is not null', [column]);
				} else if (emptyLast && nullable) {
					tier.where((after) => {
						after.whereRaw(`? ${beyond} ?`, [column, value]).orWhereRaw('? is null', [column]);
					});
				} else {
					tier.whereRaw(`? ${beyond} ?`, [column, value]);
				}
			});
		});
	});
};

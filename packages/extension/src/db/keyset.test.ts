import { describe, expect, it } from 'vitest';
import { database } from '../internals/fake-directus.js';
import { type OrderKey, pastKeys } from './keyset.js';

// The Knex of the fake Directus never connects, so no query of the test runs.

const status = (direction: 'asc' | 'desc'): OrderKey => ({
	column: database.raw('??', ['p.status']),
	direction,
	nullable: true,
});
const id: OrderKey = { column: database.raw('??', ['p.id']), direction: 'asc', nullable: false };

const whereOf = (keys: OrderKey[], values: (string | number | null)[], nulls: 'largest' | 'smallest') => {
	const builder = database.select('p.*').from('p');

	pastKeys(builder, keys, values, nulls);

	const { sql, bindings } = builder.toSQL();

	return { where: sql.slice(sql.indexOf(' where ') + ' where '.length), bindings };
};

describe('as linhas depois da última que a página viu (keyset)', () => {
	it('sem chaves, como na ordem natural que o servidor faz, o SQL vai como estava', () => {
		const builder = database.select('p.*').from('p');

		pastKeys(builder, [], [], 'smallest');

		expect(builder.toSQL().sql).toBe('select "p".* from "p"');
	});

	it('com chaves que nunca são vazias, na mesma direção, a comparação é de linhas, e cada chave se lê uma vez', () => {
		const distance: OrderKey = {
			column: database.raw('ST_Distance(??, ?)', ['p.geometry', 'POINT(0 0)']),
			direction: 'asc',
			nullable: false,
		};

		expect(whereOf([id], [42], 'largest')).toEqual({ where: '("p"."id") > (?)', bindings: [42] });
		expect(whereOf([distance, id], [12.5, 42], 'largest')).toEqual({
			where: '(ST_Distance("p"."geometry", ?), "p"."id") > (?, ?)',
			bindings: ['POINT(0 0)', 12.5, 42],
		});
		expect(
			whereOf(
				[
					{ ...distance, direction: 'desc' },
					{ ...id, direction: 'desc' },
				],
				[12.5, 42],
				'smallest',
			).where,
		).toBe('(ST_Distance("p"."geometry", ?), "p"."id") < (?, ?)');
	});

	it('com mais chaves, são as que vêm depois na primeira, ou empatam nela e vêm depois na seguinte', () => {
		expect(whereOf([status('desc'), id], ['open', 42], 'largest')).toEqual({
			where: '(("p"."status" < ?) or ("p"."status" = ? and "p"."id" > ?))',
			bindings: ['open', 'open', 42],
		});
	});

	it.each([
		// In Postgres, an empty value is the largest: last in the ascending order, and first in the descending one.
		['asc', 'largest', 'open', '((("p"."status" > ? or "p"."status" is null)) or ("p"."status" = ? and "p"."id" > ?))'],
		['asc', 'largest', null, '(("p"."status" is null and "p"."id" > ?))'],
		['desc', 'largest', 'open', '(("p"."status" < ?) or ("p"."status" = ? and "p"."id" > ?))'],
		['desc', 'largest', null, '(("p"."status" is not null) or ("p"."status" is null and "p"."id" > ?))'],
		// In SQLite, an empty value is the smallest: first in the ascending order, and last in the descending one.
		['asc', 'smallest', 'open', '(("p"."status" > ?) or ("p"."status" = ? and "p"."id" > ?))'],
		['asc', 'smallest', null, '(("p"."status" is not null) or ("p"."status" is null and "p"."id" > ?))'],
		[
			'desc',
			'smallest',
			'open',
			'((("p"."status" < ? or "p"."status" is null)) or ("p"."status" = ? and "p"."id" > ?))',
		],
		['desc', 'smallest', null, '(("p"."status" is null and "p"."id" > ?))'],
	] as const)(
		'em %s, com o vazio %s, depois de %s, o vazio fica onde o banco o põe',
		(direction, nulls, value, where) => {
			expect(whereOf([status(direction), id], [value, 42], nulls).where).toBe(where);
		},
	);
});

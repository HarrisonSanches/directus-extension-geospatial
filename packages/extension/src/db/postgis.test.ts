import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { database } from '../internals/fake-directus.js';
import type { SpatialColumn } from './adapter.js';
import { boxesOf, ringOf } from './box.js';
import { boxIn, columnIn, postgis, rowsIn, unlessProjFails } from './postgis.js';

// The Knex of the fake Directus never connects, so no query of the test runs, and one that tried would fail.

// A query in the shape of the permitted query of Maria, with each column in a case when with the rule of her policy, and
// the geometry as text (V-142).
const permitted = () =>
	database
		.select(
			database.raw('(CASE WHEN ("occurrences"."region" = ?) THEN "occurrences"."id" END) AS "id"', ['south']),
			database.raw(
				'(CASE WHEN ("occurrences"."region" = ?) THEN st_astext("occurrences"."geometry") END) AS "geometry"',
				['south'],
			),
		)
		.from('occurrences')
		.where('occurrences.region', 'south');

const center: [number, number] = [-46.7, -23.65];

// The column as Directus creates it, a geometry in 4326 (V-25).
const created: SpatialColumn = { type: 'geometry', srid: 4326 };

const radius = {
	collection: 'occurrences',
	geometry: 'geometry',
	key: 'id',
	column: created,
	boxes: boxesOf(center, 10_000),
	center,
	distance: 10_000,
	order: [],
};

const statementOf = (builder: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
	const { sql, bindings } = builder.toSQL();

	return `${sql}\n-- bindings: ${JSON.stringify(bindings)}\n`;
};

describe('o raio no PostGIS', () => {
	it('mede na coluna, dentro da query permitida, e guarda o valor que ela expõe, num SQL só (D-049)', async () => {
		const { builder } = postgis.radius(database, { ...radius, permitted: permitted(), limit: 100, offset: 0 });

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis.sql');
	});

	it('com a página, pula os itens das anteriores', async () => {
		const { builder } = postgis.radius(database, { ...radius, permitted: permitted(), limit: 100, offset: 200 });

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-offset.sql');
	});

	it('o círculo que cruza o antimeridiano usa uma caixa de cada lado', async () => {
		const { builder } = postgis.radius(database, {
			...radius,
			center: [179.99, 10],
			boxes: boxesOf([179.99, 10], 10_000),
			permitted: permitted(),
			limit: 100,
			offset: 0,
		});

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-antimeridian.sql');
	});

	it('o círculo que cobre o mundo vai sem a caixa, só com a distância', async () => {
		const { builder } = postgis.radius(database, {
			...radius,
			distance: 20_000_000,
			boxes: boxesOf(center, 20_000_000),
			permitted: permitted(),
			limit: 100,
			offset: 0,
		});

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-world.sql');
	});

	it('numa coluna em outro SRID, a caixa vai no dele, a distância lê a coluna em 4326, e a geometria sai em 4326', async () => {
		const { builder, converted } = postgis.radius(database, {
			...radius,
			column: { type: 'geometry', srid: 31983 },
			// The box of the circle in SIRGAS 2000 / UTM 23S, as PostGIS converts it.
			boxes: [[316_000, 7_373_000, 337_000, 7_394_000]],
			permitted: permitted(),
			limit: 100,
			offset: 0,
		});

		expect(converted).toBe('geospatial:4326');

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-projected.sql');
	});

	it('numa coluna geography, a distância lê a coluna, e o índice vem do próprio ST_DWithin', async () => {
		const { builder, converted } = postgis.radius(database, {
			...radius,
			column: { type: 'geography', srid: 4326 },
			boxes: null,
			permitted: permitted(),
			limit: 100,
			offset: 0,
		});

		expect(converted).toBeUndefined();

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-geography.sql');
	});

	it('numa coluna geography em outro SRID, o ponto vai para o dele, e a geometria sai em 4326', async () => {
		const { builder, converted } = postgis.radius(database, {
			...radius,
			column: { type: 'geography', srid: 4674 },
			boxes: null,
			permitted: permitted(),
			limit: 100,
			offset: 0,
		});

		expect(converted).toBe('geospatial:4326');

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-geography-srid.sql');
	});
});

describe('a contagem do resumo no PostGIS (§7.1)', () => {
	const circleOf = () => ({ ...radius, permitted: permitted().orderBy('occurrences.id') });

	it('conta os itens do círculo que a query permitida expõe, sem a ordem dela, até o limite da contagem rápida', async () => {
		await expect(statementOf(postgis.count(database, circleOf(), 10_001))).toMatchFileSnapshot(
			'../../testdata/sql/count-postgis-limit.sql',
		);
	});

	it('sem o limite, conta todos, para a contagem exata', async () => {
		await expect(statementOf(postgis.count(database, circleOf()))).toMatchFileSnapshot(
			'../../testdata/sql/count-postgis.sql',
		);
	});

	it('o tempo máximo vai no set_config da transação, antes da leitura, que roda dentro dela', async () => {
		const sent: unknown[] = [];
		const transaction = {
			raw: (sql: string, bindings: unknown[]) => {
				sent.push([sql, bindings]);

				return Promise.resolve();
			},
		};
		const knex = {
			transaction: (handler: (trx: typeof transaction) => Promise<unknown>) => handler(transaction),
		} as unknown as Knex;

		const read = await postgis.bounded?.(knex, 30_000, (trx) => {
			sent.push(trx === (transaction as unknown) ? 'read in the transaction' : 'read outside');

			return Promise.resolve(42);
		});

		expect(read).toBe(42);
		expect(sent).toEqual([["select set_config('statement_timeout', ?, true)", ['30000']], 'read in the transaction']);
	});
});

describe('a ordem do raio', () => {
	it('sem o sort, a ordem natural é a distância, calculada do texto que a query permitida expõe, e depois a chave', () => {
		const { distance } = postgis.radius(database, { ...radius, permitted: permitted(), limit: 100, offset: 0 });

		expect(distance).toBe('geospatial:distance');
	});

	it('com o sort da página, a ordem é a dela, pelo valor que a query permitida expõe, e termina na chave', async () => {
		const { builder } = postgis.radius(database, {
			...radius,
			order: [
				{ field: 'region', direction: 'asc' },
				{ field: 'id', direction: 'desc' },
			],
			permitted: permitted(),
			limit: 100,
			offset: 0,
		});

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-sorted.sql');
	});
});

describe('o cursor do raio (D-054)', () => {
	it('cada linha traz as chaves da ordem natural: a distância, e a chave primária no texto do Postgres', () => {
		const { keys } = postgis.radius(database, { ...radius, permitted: permitted(), limit: 101, offset: 0 });

		expect(keys).toEqual(['geospatial:distance', 'geospatial:key:1']);
	});

	it('com o cursor, a página começa logo depois do último item da anterior, pela distância e pela chave', async () => {
		const { builder } = postgis.radius(database, {
			...radius,
			permitted: permitted(),
			limit: 101,
			offset: 0,
			after: [1234.5, '42'],
		});

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-after.sql');
	});

	it('com o sort e o cursor, começa depois do último pelos campos da página, com o vazio onde o Postgres o põe', async () => {
		const { builder, keys } = postgis.radius(database, {
			...radius,
			order: [{ field: 'region', direction: 'desc' }],
			permitted: permitted(),
			limit: 101,
			offset: 0,
			after: [null, '42'],
		});

		expect(keys).toEqual(['geospatial:key:0', 'geospatial:key:1']);
		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-sorted-after.sql');
	});
});

// A Knex whose raw answers with the rows the test gives, or fails with its error, and keeps each statement: what only
// PostGIS would answer, the catalog and PROJ.
const answering = (answer: { rows: Record<string, unknown>[] } | Error) => {
	const statements: { sql: string; bindings: unknown[] }[] = [];
	const knex = {
		raw: (sql: string, bindings: unknown[]) => {
			statements.push({ sql, bindings });

			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		},
	} as unknown as Knex;

	return { knex, statements };
};

// The edge of a box as the text of a line in WKT, which PostGIS reads.
const wktOf = (box: [number, number, number, number]) =>
	`LINESTRING(${ringOf(box)
		.map(([x, y]) => `${String(x)} ${String(y)}`)
		.join(', ')})`;

const utm23s: SpatialColumn = { type: 'geometry', srid: 31983 };

describe('as caixas do raio no SRID da coluna', () => {
	it('em outro SRID, a borda de cada caixa vai ao PROJ, como uma linha cortada em trechos, e volta como a caixa', async () => {
		const boxes = boxesOf(center, 10_000) ?? [];
		const converted = { west: 316_000, south: 7_373_000, east: 337_000, north: 7_394_000, missed: 0 };
		const { knex, statements } = answering({ rows: [converted] });

		expect(await postgis.boxesIn(knex, utm23s, center, 10_000)).toEqual([[316_000, 7_373_000, 337_000, 7_394_000]]);
		expect(statements).toHaveLength(1);
		// The SRID as an integer, without which ST_Transform reads it as a text of PROJ (V-178).
		expect(statements[0]?.sql).toContain('ST_Transform(edge, ?::integer)');
		expect(statements[0]?.sql).toContain('(ST_GeomFromText(?, 4326))');
		expect(statements[0]?.bindings).toEqual([31983, ...boxes.map(wktOf)]);
	});

	it('com uma caixa de cada lado do antimeridiano, uma linha para cada, e sem a caixa se uma não voltar', async () => {
		const near = { west: 0, south: 0, east: 1, north: 1, missed: 0 };
		const both = answering({ rows: [near, near] });
		const one = answering({ rows: [near, { ...near, missed: 3_100 }] });

		expect(await postgis.boxesIn(both.knex, utm23s, [179.99, 10], 10_000)).toEqual([
			[0, 0, 1, 1],
			[0, 0, 1, 1],
		]);
		expect(both.statements[0]?.sql).toContain('(ST_GeomFromText(?, 4326)), (ST_GeomFromText(?, 4326))');
		expect(await postgis.boxesIn(one.knex, utm23s, [179.99, 10], 10_000)).toBeNull();
	});

	it('a caixa que o PROJ não converte deixa o raio sem a caixa', async () => {
		const outside = Object.assign(new Error('transform: Point outside of projection domain (2050)'), { code: 'XX000' });

		expect(await postgis.boxesIn(answering(outside).knex, utm23s, center, 10_000)).toBeNull();
	});

	it('numa coluna em 4326, são as do círculo, sem perguntar ao banco', async () => {
		expect(await postgis.boxesIn(database, created, center, 10_000)).toEqual(boxesOf(center, 10_000));
	});

	it('numa coluna geography, não há caixa: o ST_DWithin traz a do índice', async () => {
		expect(await postgis.boxesIn(database, { type: 'geography', srid: 4326 }, center, 10_000)).toBeNull();
	});

	it('o círculo que cobre o mundo vai sem a caixa também em outro SRID, sem perguntar ao banco', async () => {
		expect(await postgis.boxesIn(database, { type: 'geometry', srid: 31983 }, center, 20_000_000)).toBeNull();
	});

	it('em outro SRID, com o banco fora, a conversão falha, em vez de mandar o raio sem a caixa', async () => {
		await expect(postgis.boxesIn(database, { type: 'geometry', srid: 31983 }, center, 10_000)).rejects.toThrow();
	});
});

describe('o que o PostGIS devolve ao raio', () => {
	it('as linhas vêm dentro de rows, e o resto não é linha', () => {
		expect(rowsIn({ rows: [{ type: 'geometry' }, 2] })).toEqual([{ type: 'geometry' }]);
		expect(rowsIn({ rows: 'none' })).toEqual([]);
		expect(rowsIn('none')).toEqual([]);
	});

	it.each([
		['uma geometry em SIRGAS 2000 / UTM 23S', { type: 'geometry', srid: 31983 }, { type: 'geometry', srid: 31983 }],
		['uma geometry sem SRID declarado, com o 4326 do Directus', { type: 'geometry', srid: 0 }, created],
		[
			'uma geography sem SRID declarado, com o 4326 do PostGIS',
			{ type: 'geography', srid: 0 },
			{ type: 'geography', srid: 4326 },
		],
	])('o catálogo dá o tipo e o SRID de %s', (_, row, column) => {
		expect(columnIn(row, 'occurrences', 'geometry')).toEqual(column);
	});

	it('o tipo e o SRID saem do catálogo, pela tabela e pelo campo', async () => {
		const { knex, statements } = answering({ rows: [{ type: 'geometry', srid: 31983 }] });

		expect(await postgis.columnOf(knex, 'occurrences', 'geometry')).toEqual(utm23s);
		expect(statements[0]?.sql).toContain('from pg_attribute');
		expect(statements[0]?.sql).toContain('to_regclass(quote_ident(?))');
		expect(statements[0]?.bindings).toEqual(['occurrences', 'geometry']);
	});

	it.each([
		['que não é espacial', { type: 'text', srid: 0 }],
		['sem o SRID', { type: 'geometry', srid: null }],
		['que a tabela não tem', undefined],
	])('uma coluna %s, que o esquema do Directus diz ser de geometria, faz o raio falhar fechado', (_, row) => {
		expect(() => columnIn(row, 'occurrences', 'geometry')).toThrow(
			'The field geometry of occurrences is not a column of PostGIS.',
		);
	});

	it('a caixa convertida só vale onde a borda volta a menos de 1 mm de onde estava', () => {
		const box = { west: 316_000, south: 7_373_000, east: 337_000, north: 7_394_000 };

		expect(boxIn({ ...box, missed: 0 })).toEqual([316_000, 7_373_000, 337_000, 7_394_000]);
		expect(boxIn({ ...box, missed: 0.001 })).toEqual([316_000, 7_373_000, 337_000, 7_394_000]);
		expect(boxIn({ ...box, missed: 3_100 })).toBeNull();
		expect(boxIn({ ...box, missed: null })).toBeNull();

		for (const side of ['west', 'south', 'east', 'north']) {
			expect(() => boxIn({ ...box, [side]: null })).toThrow('PostGIS did not return the converted box.');
		}
	});

	it('o que o PROJ não converte vira nulo, e qualquer outro erro segue, para o raio falhar fechado', async () => {
		const outside = Object.assign(new Error('transform: Point outside of projection domain (2050)'), { code: 'XX000' });

		expect(await unlessProjFails(() => Promise.resolve(1))).toBe(1);
		expect(await unlessProjFails(() => Promise.reject(outside))).toBeNull();
		await expect(unlessProjFails(() => Promise.reject(new Error('Connection terminated')))).rejects.toThrow(
			'Connection terminated',
		);
	});
});

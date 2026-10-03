import knex from 'knex';
import { describe, expect, it } from 'vitest';
import { holdsPoints, spatialite } from './spatialite.js';

// A Knex of SQLite that never connects, so no query of the test runs. Knex loads the driver only to connect.
const database = knex({ client: 'sqlite3', useNullAsDefault: true });

// A query in the shape of the permitted query of Maria on SQLite, with each column in a case when with the rule of her
// policy, and the geometry as the text of st_astext (V-147).
const permitted = () =>
	database
		.select(
			database.raw('(CASE WHEN (`occurrences`.`region` = ?) THEN `occurrences`.`id` END) AS `id`', ['south']),
			database.raw(
				'(CASE WHEN (`occurrences`.`region` = ?) THEN st_astext(`occurrences`.`geometry`) END) AS `geometry`',
				['south'],
			),
		)
		.from('occurrences')
		.where('occurrences.region', 'south');

const center: [number, number] = [-46.7, -23.65];

const radius = {
	collection: 'occurrences',
	geometry: 'geometry',
	key: 'id',
	column: { type: 'geometry', srid: 4326 } as const,
	boxes: null,
	center,
	distance: 10_000,
	order: [],
};

const statementOf = (builder: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
	const { sql, bindings } = builder.toSQL();

	return `${sql}\n-- bindings: ${JSON.stringify(bindings)}\n`;
};

describe('o raio na SpatiaLite', () => {
	it('mede na coluna, dentro da query permitida, sobre o elipsoide, e guarda o valor que ela expõe (D-049)', async () => {
		const { builder } = spatialite.radius(database, { ...radius, permitted: permitted(), limit: 50_001, offset: 0 });

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-spatialite.sql');
	});

	it('com o sort da página, ordena pelo valor exposto e termina na chave, e pula as páginas anteriores', async () => {
		const { builder } = spatialite.radius(database, {
			...radius,
			permitted: permitted(),
			order: [{ field: 'region', direction: 'desc' }],
			limit: 100,
			offset: 200,
		});

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-spatialite-sorted.sql');
	});
});

describe('a coluna na SpatiaLite', () => {
	it('é uma geometria em 4326, sem perguntar ao banco, que não guarda os metadados espaciais (V-147)', async () => {
		expect(await spatialite.columnOf(database, 'occurrences', 'geometry')).toEqual({ type: 'geometry', srid: 4326 });
	});

	it('vai sem a caixa, porque sem os metadados não há índice espacial', async () => {
		expect(await spatialite.boxesIn(database, { type: 'geometry', srid: 4326 }, center, 10_000)).toBeNull();
	});

	it.each([
		['Point', true],
		['POINT', true],
		['LineString', false],
		['geometry', false],
	])(
		'só mede pontos: a coluna declarada %s, %s, porque com uma linha ou um polígono o PtDistWithin mede em graus',
		(type, measured) => {
			expect(holdsPoints([{ type }])).toBe(measured);
		},
	);

	it('uma coluna que o banco não mostra não é medida', () => {
		expect(holdsPoints([])).toBe(false);
		expect(holdsPoints(undefined)).toBe(false);
	});
});

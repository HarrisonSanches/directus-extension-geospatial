import { describe, expect, it } from 'vitest';
import { database } from '../internals/fake-directus.js';
import { postgis } from './postgis.js';

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

const radius = { geometry: 'geometry', key: 'id', center: [-46.7, -23.65] as [number, number], distance: 10_000 };

const statementOf = (builder: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
	const { sql, bindings } = builder.toSQL();

	return `${sql}\n-- bindings: ${JSON.stringify(bindings)}\n`;
};

describe('o raio no PostGIS', () => {
	it('envolve a query permitida num SQL só, sobre o texto da geometria que ela expõe (A-023)', async () => {
		const { builder } = postgis.radius(database, { ...radius, permitted: permitted(), limit: 100, offset: 0 });

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis.sql');
	});

	it('com a página, pula os itens das anteriores, e sem limite, traz todos', async () => {
		const { builder } = postgis.radius(database, { ...radius, permitted: permitted(), limit: null, offset: 200 });

		await expect(statementOf(builder)).toMatchFileSnapshot('../../testdata/sql/radius-postgis-offset.sql');
	});
});

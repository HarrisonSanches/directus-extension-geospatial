import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { type Query, readVersions } from './versions.js';

// A real SQLite, the one inside Node, which answers the same SQL as the one Directus uses.
const sqlite = (): { database: DatabaseSync; query: Query } => {
	const database = new DatabaseSync(':memory:');

	return { database, query: (sql) => Promise.resolve(database.prepare(sql).all()) };
};

describe('coleta das versões', () => {
	it('no SQLite, lê a versão do banco e, sem SpatiaLite, nenhuma extensão espacial', async () => {
		const { query } = sqlite();

		expect(await readVersions('sqlite', query)).toEqual({
			databaseVersion: process.versions.sqlite,
			spatialVersion: null,
		});
	});

	it('no SQLite com a função spatialite_version, devolve a versão que ela informa', async () => {
		const { database, query } = sqlite();
		// The version the SpatiaLite of Debian trixie reports (testdata/versions/debian-trixie-spatialite.json).
		database.function('spatialite_version', () => '5.1.0');

		expect(await readVersions('sqlite', query)).toMatchObject({ spatialVersion: '5.1.0' });
	});

	it('num banco que a extensão ainda não lê, não manda SQL nenhum', async () => {
		const sent: string[] = [];
		const query: Query = (sql) => {
			sent.push(sql);

			return Promise.resolve([]);
		};

		expect(await readVersions('mysql', query)).toEqual({ databaseVersion: null, spatialVersion: null });
		expect(sent).toEqual([]);
	});
});

import { describe, expect, it } from 'vitest';
import sqliteWithSpatialite from '../../testdata/versions/debian-trixie-spatialite.json' with { type: 'json' };
import directus11 from '../../testdata/versions/directus-11.17.4-sqlite.json' with { type: 'json' };
import directus12 from '../../testdata/versions/directus-12.4.1-sqlite.json' with { type: 'json' };
import postgis14 from '../../testdata/versions/postgis-14-3.5.json' with { type: 'json' };
import postgis18Alpine from '../../testdata/versions/postgis-18-3.6-alpine.json' with { type: 'json' };
import postgis18 from '../../testdata/versions/postgis-18-3.6.json' with { type: 'json' };
import postgres18 from '../../testdata/versions/postgres-18-alpine.json' with { type: 'json' };
import { detectCapabilities } from './detect.js';

const versions = { apiVersion: '0.1.0', extensionVersion: '0.1.0', directusVersion: '12.4.1' };

describe('detecção do ambiente', () => {
	it.each([
		['do Debian', postgis18, '18.6', '3.6.4'],
		['do Alpine', postgis18Alpine, '18.6', '3.6.4'],
		['14 do Debian', postgis14, '14.18', '3.5.2'],
	])('o Postgres %s com PostGIS informa a versão major.minor e a do PostGIS', (_, output, version, postgis) => {
		const capabilities = detectCapabilities({ ...versions, client: 'postgres', ...output });

		expect(capabilities.database).toEqual({ client: 'postgres', version });
		expect(capabilities.spatial).toEqual({ name: 'postgis', version: postgis });
	});

	it('o Postgres sem PostGIS informa a versão e nenhuma extensão espacial', () => {
		const capabilities = detectCapabilities({ ...versions, client: 'postgres', ...postgres18 });

		expect(capabilities.database).toEqual({ client: 'postgres', version: '18.6' });
		expect(capabilities.spatial).toBeNull();
	});

	it('o SQLite com SpatiaLite informa a versão major.minor e a da SpatiaLite', () => {
		const capabilities = detectCapabilities({ ...versions, client: 'sqlite', ...sqliteWithSpatialite });

		expect(capabilities.database).toEqual({ client: 'sqlite', version: '3.46' });
		expect(capabilities.spatial).toEqual({ name: 'spatialite', version: '5.1.0' });
	});

	it.each([
		['12.4.1', directus12, '3.52'],
		['11.17.4', directus11, '3.44'],
	])(
		'o SQLite da imagem do Directus %s, sem SpatiaLite, informa a versão e nenhuma extensão espacial',
		(_, output, version) => {
			const capabilities = detectCapabilities({ ...versions, client: 'sqlite', ...output });

			expect(capabilities.database).toEqual({ client: 'sqlite', version });
			expect(capabilities.spatial).toBeNull();
		},
	);

	it.each(['mysql', 'mssql', 'oracle', 'cockroachdb', 'redshift', 'unknown'] as const)(
		'o banco %s, que a extensão ainda não lê, informa o nome, sem versão e sem extensão espacial',
		(client) => {
			const capabilities = detectCapabilities({ ...versions, client, databaseVersion: null, spatialVersion: null });

			expect(capabilities.database).toEqual({ client, version: null });
			expect(capabilities.spatial).toBeNull();
		},
	);
});

describe('versões e matriz', () => {
	it('a matriz sai vazia, e as versões da API, da extensão e do Directus saem como vieram', () => {
		const capabilities = detectCapabilities({
			apiVersion: '0.2.0',
			extensionVersion: '0.3.1',
			directusVersion: '11.17.4',
			client: 'postgres',
			...postgis18,
		});

		expect(capabilities).toMatchObject({
			api: { version: '0.2.0' },
			extension: { version: '0.3.1' },
			directus: { version: '11.17.4' },
			operations: {},
		});
	});
});

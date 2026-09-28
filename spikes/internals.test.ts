import { readFile } from 'node:fs/promises';
import { customEndpoint } from '@directus/sdk';
import { describe, expect, inject, it } from 'vitest';
import { as, type Role } from '../test/directus.ts';
import { log } from '../test/environment.ts';

// What the spike compares between its imports from @directus/api and the context Directus hands to the extension.
interface Internals {
	itemsService: boolean;
	database: boolean;
	getSchema: boolean;
	resolved: string;
}

const internals = (role: Role) =>
	as(role).request(customEndpoint<Internals>({ path: '/geospatial-spikes/internals', method: 'GET' }));

const bundle = new URL('extension/dist/api.js', import.meta.url);

describe('a extensão de prova e os internos do Directus (F01-01)', () => {
	it('o ItemsService, a conexão e o getSchema que ela importa do @directus/api são os do Directus em execução', async () => {
		expect(await internals('admin')).toMatchObject({ itemsService: true, database: true, getSchema: true });
	});

	it('o @directus/api resolve para o pacote que a imagem do Directus instalou', async () => {
		const { resolved } = await internals('admin');

		log(`${inject('combination')}: @directus/api/services/items resolves to ${resolved}`);
		expect(resolved).toMatch(/^file:\/\/\/directus\/node_modules\/(.+\/)?@directus\/api\/dist\/services\/items\.js$/);
	});

	it('o bundle importa o @directus/api e não traz o código dele (V-60)', async () => {
		const code = await readFile(bundle, 'utf8');

		for (const path of ['database/index', 'services/items', 'utils/get-schema']) {
			expect(code).toContain(`from '@directus/api/${path}'`);
		}

		expect(code).not.toMatch(/\bclass ItemsService\b/);
	});

	it('só o admin lê a rota de prova', async () => {
		for (const role of ['maria', 'public'] as const) {
			await expect(internals(role)).rejects.toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
		}
	});
});

import { customEndpoint } from '@directus/sdk';
import { describe, expect, inject, it } from 'vitest';
import { as, type Role, versions } from './directus.ts';
import type { Capabilities } from 'directus-geospatial-contract';

const capabilities = (role: Role) =>
	as(role).request(customEndpoint<Capabilities>({ path: '/geospatial/capabilities', method: 'GET' }));

// The extension reports the version of the database as major.minor.
const majorMinor = (version: string) => version.split('.').slice(0, 2).join('.');

// Each combination starts with the Directus version line, which names its adapter.
const [adapter] = inject('combination').split('-');

describe('GET /geospatial/capabilities num Directus de verdade', () => {
	it('para o admin, responde com o banco e a extensão espacial da combinação, nas versões que eles informam', async () => {
		const { directus, database, spatial } = versions();

		expect(await capabilities('admin')).toMatchObject({
			directus: { version: directus },
			database: { client: database.client, version: majorMinor(database.version) },
			spatial,
		});
	});

	it('para o admin, mostra os internos aceitos, com o adaptador da versão do Directus', async () => {
		expect((await capabilities('admin')).internals).toEqual({ status: 'accepted', adapter });
	});

	it('para quem tem sessão e não é admin, mostra as versões e esconde o banco e os internos (D-042)', async () => {
		const response = await capabilities('maria');

		expect(response).toMatchObject({ directus: { version: versions().directus } });
		expect(response).not.toHaveProperty('database');
		expect(response).not.toHaveProperty('spatial');
		expect(response).not.toHaveProperty('internals');
	});

	it('sem sessão, recebe o FORBIDDEN do Directus', async () => {
		await expect(capabilities('public')).rejects.toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
	});
});

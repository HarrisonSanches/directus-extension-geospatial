import { customEndpoint } from '@directus/sdk';
import { describe, expect, inject, it } from 'vitest';
import { as, type Role } from './directus.js';
import type { Capabilities } from 'directus-geospatial-contract';

const capabilities = (role: Role) =>
	as(role).request(customEndpoint<Capabilities>({ path: '/geospatial/capabilities', method: 'GET' }));

describe('GET /geospatial/capabilities num Directus de verdade', () => {
	it('para o admin, responde com o Postgres e o PostGIS do container, nas versões que eles informam', async () => {
		const { versions } = inject('directus');

		expect(await capabilities('admin')).toMatchObject({
			directus: { version: versions.directus },
			database: { client: 'postgres', version: versions.postgres },
			spatial: { name: 'postgis', version: versions.postgis },
		});
	});

	it('para quem tem sessão e não é admin, mostra as versões e esconde o banco (D-042)', async () => {
		const response = await capabilities('maria');

		expect(response).toMatchObject({ directus: { version: inject('directus').versions.directus } });
		expect(response).not.toHaveProperty('database');
		expect(response).not.toHaveProperty('spatial');
	});

	it('sem sessão, recebe o FORBIDDEN do Directus', async () => {
		await expect(capabilities('public')).rejects.toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
	});
});

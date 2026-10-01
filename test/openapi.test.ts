import { customEndpoint } from '@directus/sdk';
import { describe, expect, it } from 'vitest';
import { as, type Role } from './directus.ts';
import { openapi } from 'directus-geospatial-contract';

const documentFor = (role: Role) =>
	as(role).request(customEndpoint({ path: '/geospatial/openapi.json', method: 'GET' }));

describe('GET /geospatial/openapi.json num Directus de verdade', () => {
	it('quem tem sessão recebe o documento do contrato, o mesmo do openapi.yaml', async () => {
		expect(await documentFor('maria')).toEqual(openapi);
		expect(await documentFor('admin')).toEqual(openapi);
	});

	it('sem sessão, recebe o FORBIDDEN do Directus (D-042)', async () => {
		await expect(documentFor('public')).rejects.toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
	});

	// Every response of the extension in the suite goes through the contract (test/contract.ts), and the 404 of a route
	// it does not describe is off it.
	it('uma resposta da extensão fora do contrato reprova o pedido', async () => {
		await expect(as('admin').request(customEndpoint({ path: '/geospatial/unknown', method: 'GET' }))).rejects.toThrow(
			'The contract has no route for GET /geospatial/unknown.',
		);
	});
});

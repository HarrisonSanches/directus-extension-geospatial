import type { Capabilities } from 'directus-geospatial-contract';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { geoCapabilities } from './capabilities.js';
import { isGeospatialError } from './errors.js';
import { fakeClient } from './fake-fetch.js';

const capabilities: Capabilities = {
	api: { version: '0.1.0' },
	extension: { version: '0.1.0' },
	directus: { version: '12.4.1' },
	operations: { radius: { level: 'indexed' } },
};

describe('geoCapabilities()', () => {
	it('lê o GET /geospatial/capabilities e devolve a matriz, como a rota a dá no data', async () => {
		const { client, requests } = fakeClient({ body: { data: capabilities } });
		const read = await client.request(geoCapabilities());

		expect(read).toEqual(capabilities);
		expectTypeOf(read).toEqualTypeOf<Capabilities>();
		expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
			'GET https://directus.example.com/geospatial/capabilities',
		]);
	});

	it('quem não tem sessão recebe o FORBIDDEN do Directus como erro tipado (D-042)', async () => {
		const { client } = fakeClient({
			status: 403,
			body: { errors: [{ message: 'You do not have permission to access this.', extensions: { code: 'FORBIDDEN' } }] },
		});
		const error: unknown = await client.request(geoCapabilities()).catch((thrown: unknown) => thrown);

		expect(isGeospatialError(error, 'FORBIDDEN')).toBe(true);
	});
});

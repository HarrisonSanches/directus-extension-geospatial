import { customEndpoint } from '@directus/sdk';
import { describe, expect, it } from 'vitest';
import { fakeClient } from './fake-fetch.js';

describe('o servidor falso dos unitários', () => {
	it('com uma lista, responde cada pedido com a resposta seguinte, e recusa o pedido para o qual o teste não deu resposta', async () => {
		const { client, requests } = fakeClient([{ body: { data: 'first' } }]);
		const command = customEndpoint<string>({ path: '/geospatial/capabilities' });

		expect(await client.request(command)).toBe('first');
		await expect(client.request(command)).rejects.toThrow('The test has no answer for request 2.');
		expect(requests).toHaveLength(2);
	});
});

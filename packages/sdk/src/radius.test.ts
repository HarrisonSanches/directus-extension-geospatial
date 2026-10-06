import { type GeoValues, type ItemsMeta, wholeBodyType } from 'directus-geospatial-contract';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { fakeClient } from './fake-fetch.js';
import { geoRadius, type GeoRadiusQuery } from './radius.js';

interface Occurrence {
	id: number;
	geometry: { type: 'Point'; coordinates: [number, number] };
	region: string;
	status: string;
}

interface Schema {
	occurrences: Occurrence[];
}

const center: [number, number] = [-46.6333, -23.5505];
const meta: ItemsMeta = { next: 'next-page', capped: { limit: 50_000 } };

describe('geoRadius()', () => {
	it('pede a lista no tipo próprio da extensão e devolve o data e o meta, que o SDK do Directus deixaria de fora (D-058)', async () => {
		const data = [{ id: 1, region: 'south', $geo: { distance: 120.5 } }];
		const { client, requests } = fakeClient<Schema>({ type: wholeBodyType, body: { data, meta } });
		const read = await client.request(
			geoRadius('occurrences', {
				center,
				distance: 1000,
				fields: ['id', 'region'],
				filter: { status: { _eq: 'open' } },
				sort: ['-id'],
				limit: 10,
				cursor: 'this-page',
			}),
		);

		expect(read).toEqual({ data, meta });
		expectTypeOf(read.data).toEqualTypeOf<{ id: number; region: string; $geo: GeoValues }[]>();
		expectTypeOf(read.meta).toEqualTypeOf<ItemsMeta | undefined>();

		const [request] = requests;
		const url = new URL(String(request?.url));

		expect(request?.method).toBe('GET');
		expect(request?.headers.get('Accept')).toBe(wholeBodyType);
		expect(url.pathname).toBe('/geospatial/items/occurrences');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			geo: JSON.stringify({ operation: 'radius', center, distance: 1000 }),
			fields: 'id,region',
			filter: JSON.stringify({ status: { _eq: 'open' } }),
			sort: '-id',
			limit: '10',
			cursor: 'this-page',
		});
	});

	it('o campo de geometria, quando a coleção tem mais de um, vai no geo, e a página do /items, como o readItems a manda', async () => {
		const { client, requests } = fakeClient<Schema>({ type: wholeBodyType, body: { data: [] } });

		await client.request(
			geoRadius('occurrences', { field: 'geometry', center, distance: 50, search: 'theft', offset: 20, page: 2 }),
		);

		expect(Object.fromEntries(new URL(String(requests[0]?.url)).searchParams)).toEqual({
			geo: JSON.stringify({ operation: 'radius', field: 'geometry', center, distance: 50 }),
			search: 'theft',
			offset: '20',
			page: '2',
		});
	});

	it('uma extensão que responde application/json, sem o tipo próprio, dá os itens, sem o meta', async () => {
		const data = [{ id: 1, $geo: { distance: 0 } }];
		const { client } = fakeClient<Schema>({ body: { data, meta } });

		expect(await client.request(geoRadius('occurrences', { center, distance: 10, fields: ['id'] }))).toEqual({ data });
	});

	it('a coleção vazia é recusada antes do pedido, como no readItems', async () => {
		// A schema that names no collection, as a project that does not type its own.
		const { client, requests } = fakeClient<Record<string, unknown[]>>({ body: { data: [] } });

		await expect(client.request(geoRadius('', { center, distance: 1 }))).rejects.toThrow('Collection cannot be empty');
		expect(requests).toEqual([]);
	});

	it('os campos se completam pelo esquema de quem usa: um campo que a coleção não tem não entra na query', () => {
		expectTypeOf<{ center: [number, number]; distance: number; fields: ['id', 'region'] }>().toExtend<
			GeoRadiusQuery<Schema, Occurrence>
		>();
		expectTypeOf<{ center: [number, number]; distance: number; fields: ['missing'] }>().not.toExtend<
			GeoRadiusQuery<Schema, Occurrence>
		>();
		expectTypeOf<{ center: [number, number]; distance: number; field: 'missing' }>().not.toExtend<
			GeoRadiusQuery<Schema, Occurrence>
		>();
	});
});

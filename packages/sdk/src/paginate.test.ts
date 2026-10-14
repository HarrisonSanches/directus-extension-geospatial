import { type Shapes, wholeBodyType } from 'directus-geospatial-contract';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isGeospatialError } from './errors.js';
import { type Answer, fakeClient } from './fake-fetch.js';
import { geoPaginate } from './paginate.js';
import { geoQueryItems, type GeoQueryItemsOutput, geoQueryShapes } from './queries.js';
import { geoRadius } from './radius.js';

interface Occurrence {
	id: number;
	geometry: { type: 'Point'; coordinates: [number, number] };
	region: string;
}

interface Schema {
	occurrences: Occurrence[];
}

const id = 'AAAAAAAAAAAAAAAAAAAAAA';

// A page of the list, with the cursor of the next one, or without it on the last.
const page = (ids: number[], next?: string): Answer => ({
	type: wholeBodyType,
	body: {
		data: ids.map((itemId) => ({ id: itemId, $geo: { distance: itemId } })),
		...(next !== undefined && { meta: { next } }),
	},
});

// Every page an iterator gives, in order.
const all = async <Page>(pages: AsyncIterable<Page>): Promise<Page[]> => {
	const read: Page[] = [];

	for await (const each of pages) {
		read.push(each);
	}

	return read;
};

describe('geoPaginate()', () => {
	it('percorre a lista inteira pelo cursor, cada página inteira, até a que não traz o seguinte', async () => {
		const { client, requests } = fakeClient<Schema>([page([1, 2], 'second'), page([3, 4], 'third'), page([5])]);
		const pages = await all(geoPaginate(client, geoQueryItems(id, { limit: 2, sort: ['region'] })));

		expect(pages.flatMap(({ data }) => data.map((item) => item.id))).toEqual([1, 2, 3, 4, 5]);
		expect(pages.map(({ meta }) => meta?.next)).toEqual(['second', 'third', undefined]);
		expect(requests.map(({ url }) => Object.fromEntries(new URL(url).searchParams))).toEqual([
			{ limit: '2', sort: 'region' },
			{ limit: '2', sort: 'region', cursor: 'second' },
			{ limit: '2', sort: 'region', cursor: 'third' },
		]);
		expect(requests.every((request) => request.headers.get('Accept') === wholeBodyType)).toBe(true);
	});

	it('cada página é o que o comando dá, com o meta, e o capped de uma lista parcial chega a quem lê (D-052)', async () => {
		const capped: Answer = { type: wholeBodyType, body: { data: [], meta: { capped: { limit: 50_000 } } } };
		const { client } = fakeClient<Schema>(capped);
		const pages = geoPaginate(client, geoQueryItems(id));

		expectTypeOf(pages).toEqualTypeOf<AsyncGenerator<GeoQueryItemsOutput<Schema, unknown, unknown>, void>>();
		expect((await all(pages))[0]?.meta).toEqual({ capped: { limit: 50_000 } });
	});

	it('começa no cursor que o comando já traz, e serve a toda lista com cursor: o raio do estilo do /items e as formas', async () => {
		const radius = fakeClient<Schema>([page([3], 'last'), page([4])]);
		const pages = await all(
			geoPaginate(radius.client, geoRadius('occurrences', { center: [0, 0], distance: 10, cursor: 'given' })),
		);

		expect(pages.flatMap(({ data }) => data.map((item) => item.id))).toEqual([3, 4]);
		expect(radius.requests.map(({ url }) => new URL(url).searchParams.get('cursor'))).toEqual(['given', 'last']);

		const circle: Shapes = { data: { type: 'FeatureCollection', features: [] } };
		const shapes = fakeClient<Schema>({ type: wholeBodyType, body: circle });

		expect(await all(geoPaginate(shapes.client, geoQueryShapes(id)))).toEqual([circle]);
	});

	it('um erro numa página seguinte, como o id que o Directus esqueceu, chega no for await, depois das páginas lidas', async () => {
		const unknown: Answer = {
			status: 404,
			body: { errors: [{ message: 'Unknown query.', extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }] },
		};
		const { client } = fakeClient<Schema>([page([1], 'second'), unknown]);
		const read: number[] = [];
		const error: unknown = await (async () => {
			for await (const { data } of geoPaginate(client, geoQueryItems(id))) {
				read.push(...data.map((item) => Number(item.id)));
			}
		})().catch((thrown: unknown) => thrown);

		expect(read).toEqual([1]);
		expect(isGeospatialError(error, 'GEOSPATIAL_UNKNOWN_QUERY')).toBe(true);
	});

	it('uma página em application/json, sem o meta, como um proxy a entregaria, falha em vez de acabar a lista ali (D-058)', async () => {
		const { client, requests } = fakeClient<Schema>({ body: { data: [{ id: 1, $geo: { distance: 0 } }], meta: {} } });
		const error: unknown = await (async () => {
			for await (const read of geoPaginate(client, geoQueryItems(id))) {
				expect(read).toBeUndefined();
			}
		})().catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(Error);
		expect(String(error)).toContain(wholeBodyType);
		expect(requests).toHaveLength(1);
	});

	it('sair do for await no meio não pede a página seguinte', async () => {
		const { client, requests } = fakeClient<Schema>([page([1], 'second'), page([2])]);

		for await (const { data } of geoPaginate(client, geoQueryItems(id))) {
			expect(data).toHaveLength(1);

			break;
		}

		expect(requests).toHaveLength(1);
	});
});

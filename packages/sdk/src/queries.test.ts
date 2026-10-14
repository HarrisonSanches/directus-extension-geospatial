import {
	type GeoValues,
	type Item,
	type ItemsMeta,
	type Shapes,
	type SummaryValues,
	wholeBodyType,
} from 'directus-geospatial-contract';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isGeospatialError } from './errors.js';
import { fakeClient } from './fake-fetch.js';
import {
	type GeoQuery,
	geoQueryItems,
	geoQueryShapes,
	geoQuerySummary,
	type GeoQuestion,
	geoRegisterQuery,
} from './queries.js';

interface Reporter {
	id: number;
	name: string;
}

interface Occurrence {
	id: number;
	geometry: { type: 'Point'; coordinates: [number, number] };
	region: string;
	status: string;
	reporter: number | Reporter;
}

interface Schema {
	occurrences: Occurrence[];
	reporters: Reporter[];
}

const center: [number, number] = [-46.6333, -23.5505];
const geo = { operation: 'radius', center, distance: 1000 } as const;
const id = 'AAAAAAAAAAAAAAAAAAAAAA';

// A query the registration of the test gave, with the fields id and region.
const registered = async () => {
	const { client } = fakeClient<Schema>({ body: { data: { id } } });

	return client.request(geoRegisterQuery('occurrences', { geo, fields: ['id', 'region'] }));
};

const circle: Shapes = {
	data: {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Polygon', coordinates: [[center, [-46.6, -23.5], [-46.7, -23.6], center]] },
				properties: { center, distance: 1000 },
			},
		],
	},
};

describe('geoRegisterQuery()', () => {
	it('registra a pergunta inteira no corpo, com os campos em lista, como o Directus os lê, e devolve a consulta pelo id (D-004)', async () => {
		const { client, requests } = fakeClient<Schema>({ body: { data: { id } } });
		const query = await client.request(
			geoRegisterQuery('occurrences', {
				geo: { ...geo, field: 'geometry' },
				fields: ['id', { reporter: ['name'] }],
				filter: { status: { _eq: 'open' } },
				search: 'theft',
			}),
		);

		expect(query).toEqual({ id });

		const [request] = requests;

		expect(request?.method).toBe('POST');
		expect(new URL(String(request?.url)).pathname).toBe('/geospatial/queries');
		expect(request?.headers.get('Content-Type')).toBe('application/json');
		expect(await request?.json()).toEqual({
			collection: 'occurrences',
			geo: { ...geo, field: 'geometry' },
			query: { fields: ['id', 'reporter.name'], filter: { status: { _eq: 'open' } }, search: 'theft' },
		});
	});

	it('sem filtro, busca nem campos, a pergunta vai sem a query', async () => {
		const { client, requests } = fakeClient<Schema>({ body: { data: { id } } });

		await client.request(geoRegisterQuery('occurrences', { geo }));

		expect(await requests[0]?.json()).toEqual({ collection: 'occurrences', geo });
	});

	it('a coleção vazia é recusada antes do pedido, como no readItems', async () => {
		const { client, requests } = fakeClient<Record<string, unknown[]>>({ body: { data: { id } } });

		await expect(client.request(geoRegisterQuery('', { geo }))).rejects.toThrow('Collection cannot be empty');
		expect(requests).toEqual([]);
	});

	it('os campos e o campo de geometria se completam pelo esquema de quem usa', () => {
		expectTypeOf<{ geo: typeof geo; fields: ['id', 'region'] }>().toExtend<GeoQuestion<Schema, Occurrence>>();
		expectTypeOf<{ geo: typeof geo; fields: ['missing'] }>().not.toExtend<GeoQuestion<Schema, Occurrence>>();
		expectTypeOf<{ geo: typeof geo & { field: 'missing' } }>().not.toExtend<GeoQuestion<Schema, Occurrence>>();
	});
});

describe('as partes da consulta registrada (D-022)', () => {
	it('o geoQueryItems() pede a página no tipo próprio da extensão e dá os itens com o meta, tipados pelos campos do registro', async () => {
		const query = await registered();
		const data = [{ id: 1, region: 'south', $geo: { distance: 120.5 } }];
		const meta: ItemsMeta = { next: 'next-page' };
		const { client, requests } = fakeClient<Schema>({ type: wholeBodyType, body: { data, meta } });
		const read = await client.request(geoQueryItems(query, { sort: ['-id'], limit: 10, cursor: 'this-page' }));

		expect(read).toEqual({ data, meta });
		expectTypeOf(read.data).toEqualTypeOf<{ id: number; region: string; $geo: GeoValues }[]>();
		expectTypeOf(read.meta).toEqualTypeOf<ItemsMeta | undefined>();

		const [request] = requests;
		const url = new URL(String(request?.url));

		expect(request?.method).toBe('GET');
		expect(request?.headers.get('Accept')).toBe(wholeBodyType);
		expect(url.pathname).toBe(`/geospatial/queries/${id}/items`);
		expect(Object.fromEntries(url.searchParams)).toEqual({ sort: '-id', limit: '10', cursor: 'this-page' });
	});

	it('pelo id sozinho, como o de um link, os itens vêm com o tipo do contrato', async () => {
		const { client } = fakeClient<Schema>({ type: wholeBodyType, body: { data: [] } });
		const read = await client.request(geoQueryItems(id));

		expectTypeOf(read.data).toEqualTypeOf<Item[]>();
		expect(read).toEqual({ data: [] });
	});

	it('o geoQueryShapes() dá as formas em GeoJSON com o meta, e o geoQuerySummary(), o resumo, nos tipos do contrato', async () => {
		const query = await registered();
		const shapes = fakeClient<Schema>({ type: wholeBodyType, body: circle });
		const summary: SummaryValues = { total: 10_000, exact: false, counting: true };
		const summed = fakeClient<Schema>({ body: { data: summary } });
		const readShapes = await shapes.client.request(geoQueryShapes(query, { limit: 5 }));
		const readSummary = await summed.client.request(geoQuerySummary(query));

		expect(readShapes).toEqual(circle);
		expectTypeOf(readShapes).toEqualTypeOf<Shapes>();
		expect(readSummary).toEqual(summary);
		expectTypeOf(readSummary).toEqualTypeOf<SummaryValues>();

		const [shapesRequest] = shapes.requests;
		const [summaryRequest] = summed.requests;

		expect(shapesRequest?.headers.get('Accept')).toBe(wholeBodyType);
		expect(new URL(String(shapesRequest?.url)).pathname).toBe(`/geospatial/queries/${id}/shapes`);
		expect(Object.fromEntries(new URL(String(shapesRequest?.url)).searchParams)).toEqual({ limit: '5' });
		expect(new URL(String(summaryRequest?.url)).pathname).toBe(`/geospatial/queries/${id}/summary`);
	});

	it('o id vai no caminho escapado, e um id vazio é recusado antes do pedido', async () => {
		const { client, requests } = fakeClient<Schema>({ body: { data: { total: 0, exact: true, counting: false } } });

		await client.request(geoQuerySummary('a/../b'));

		expect(new URL(String(requests[0]?.url)).pathname).toBe('/geospatial/queries/a%2F..%2Fb/summary');
		await expect(client.request(geoQuerySummary(''))).rejects.toThrow('Query id cannot be empty');
		expect(requests).toHaveLength(1);
	});

	it('o id que o Directus esqueceu chega como o erro tipado de consulta desconhecida, que quem usa trata registrando de novo', async () => {
		const { client } = fakeClient<Schema>({
			status: 404,
			body: { errors: [{ message: 'Unknown query.', extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }] },
		});
		const error: unknown = await client.request(geoQueryItems(id)).catch((thrown: unknown) => thrown);

		expect(isGeospatialError(error, 'GEOSPATIAL_UNKNOWN_QUERY')).toBe(true);
	});

	it('uma extensão que responde application/json, sem o tipo próprio, dá a lista sem o meta', async () => {
		const { client } = fakeClient<Schema>({ body: circle });

		expect(await client.request(geoQueryShapes(id))).toEqual({ data: circle.data });
	});

	it('a consulta do registro leva os tipos às partes, e só a do registro: um objeto qualquer não é uma consulta', () => {
		expectTypeOf<GeoQuery<Schema, 'occurrences', ['id']>>().toExtend<{ id: string }>();
		expectTypeOf<{ id: number }>().not.toExtend<GeoQuery>();
	});
});

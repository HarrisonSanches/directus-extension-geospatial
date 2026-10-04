import { customEndpoint, readItems } from '@directus/sdk';
import { describe, expect, it } from 'vitest';
import { as, type Client, hasCustomPermissionRules } from './directus.ts';
import { circle, wgs84 } from './seed.ts';
import type { Position, ShapeCollection } from 'directus-geospatial-contract';

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };
const question = { collection: 'occurrences', geo, query: { fields: ['id', 'region'] } };

// Registers a question, and returns its id. Each response goes through the contract (test/contract.ts).
const registered = async (client: Client, asked: Record<string, unknown>) =>
	(
		await client.request(
			customEndpoint<{ id: string }>({ path: '/geospatial/queries', method: 'POST', body: JSON.stringify(asked) }),
		)
	).id;

// The shapes of a registered query, by its id, with the page in the URL.
const shapesOf = (client: Client, id: string, params: Record<string, unknown> = {}) =>
	client.request(customEndpoint<ShapeCollection>({ path: `/geospatial/queries/${id}/shapes`, method: 'GET', params }));

// The error a request fails with, in the format of Directus.
const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error;
	}

	throw new Error('The request did not fail.');
};

const errorsOf = async (request: Promise<unknown>) => {
	const error = await errorOf(request);

	return error instanceof Object && 'errors' in error ? error.errors : error;
};

// Maria, where Directus takes the rule of her policy, or else the admin (V-114).
const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

// The distance from the center of the circle, in meters over the ellipsoid, by GeographicLib.
const fromCenter = ([longitude, latitude]: Position) =>
	Number(wgs84.Inverse(circle.center[1], circle.center[0], latitude, longitude).s12);

describe('as formas da consulta registrada (D-022)', () => {
	it('o círculo do raio da Maria sai em GeoJSON, com o centro e a distância nas propriedades, e os vértices à distância', async () => {
		const id = await registered(user(), question);
		const { type, features } = await shapesOf(user(), id);
		const [feature, ...others] = features;
		const [ring = []] = feature?.geometry.type === 'Polygon' ? feature.geometry.coordinates : [];
		const sides = ring.slice(1).map((end, index): [Position, Position] => [ring[index] ?? end, end]);

		expect(type).toBe('FeatureCollection');
		expect(others).toEqual([]);
		expect(feature?.properties).toEqual({ center: circle.center, distance: circle.meters });
		// The 128 sides of D-055, and the point that closes the ring.
		expect(ring).toHaveLength(129);
		// Each vertex on the circle, over the ellipsoid, as GeographicLib measures it.
		expect(Math.max(...ring.map((vertex) => Math.abs(fromCenter(vertex) - circle.meters)))).toBeLessThan(0.001);
		// Each side inside the circle, within the tolerance of the polygon of D-023, 0.03% of the distance.
		expect(
			Math.max(...sides.map(([[x0, y0], [x1, y1]]) => 1 - fromCenter([(x0 + x1) / 2, (y0 + y1) / 2]) / circle.meters)),
		).toBeLessThan(0.00031);
	});

	it('cortado no antimeridiano, o círculo sai em dois polígonos, que passam pelo contrato', async () => {
		const id = await registered(user(), {
			collection: 'occurrences',
			geo: { operation: 'radius', center: [179.9, -17], distance: 100_000 },
		});
		const [feature] = (await shapesOf(user(), id)).features;

		expect(feature?.geometry.type).toBe('MultiPolygon');
		expect(feature?.geometry.coordinates).toHaveLength(2);
	});

	it('o público, que não lê as ocorrências, recebe nas formas o mesmo erro do /items', async () => {
		const id = await registered(user(), question);
		const items = await errorsOf(as('public').request(readItems('occurrences')));

		expect(await errorsOf(shapesOf(as('public'), id))).toEqual(items);
		expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
	});

	it.runIf(hasCustomPermissionRules())(
		'sem permissão na geometria, as formas dão o erro do /items que a pede, como os itens',
		async () => {
			const client = as('withoutGeometry');
			const id = await registered(client, { collection: 'occurrences', geo });
			const items = await errorsOf(client.request(readItems('occurrences', { fields: ['*', 'geometry'] })));

			expect(await errorsOf(shapesOf(client, id))).toEqual(items);
			expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
		},
	);

	it('um cursor volta com o erro de entrada, o sort na URL com o INVALID_QUERY, e um id esquecido, com o de consulta desconhecida', async () => {
		const id = await registered(user(), question);

		expect(await errorOf(shapesOf(user(), id, { cursor: 'AAAA' }))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_INVALID_INPUT' } }],
			response: { status: 400 },
		});
		expect(await errorOf(shapesOf(user(), id, { sort: 'id' }))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY' } }],
			response: { status: 400 },
		});
		expect(await errorOf(shapesOf(user(), 'AAAAAAAAAAAAAAAAAAAAAA'))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }],
			response: { status: 404 },
		});
	});
});

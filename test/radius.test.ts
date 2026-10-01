import { createCollection, createPermission, customEndpoint, readItems, readPolicies } from '@directus/sdk';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { as, type Client, databaseContainer, hasCustomPermissionRules, type Occurrence } from './directus.ts';
import { callsOn } from './postgres.ts';
import { circle, southZone, wgs84 } from './seed.ts';
import type { Capabilities, Item } from 'directus-geospatial-contract';

const postgis = combinations[inject('combination')].database.client === 'postgres';

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// The radius in the format of /items. The geo goes as an object, and the SDK of Directus sends it as JSON, as it sends
// any parameter it does not know (V-171). Each response goes through the contract (test/contract.ts).
const radius = (client: Client, params: Record<string, unknown> = {}, collection = 'occurrences') =>
	client.request(
		customEndpoint<Item[]>({ path: `/geospatial/items/${collection}`, method: 'GET', params: { geo, ...params } }),
	);

const distanceOf = ({ coordinates: [longitude, latitude] }: Occurrence['geometry']) => {
	const [centerLongitude, centerLatitude] = circle.center;
	const { s12 } = wgs84.Inverse(centerLatitude, centerLongitude, latitude, longitude);

	if (s12 === undefined) {
		throw new Error('GeographicLib did not return the distance.');
	}

	return s12;
};

// What /items gives a user inside the circle, by the distance of GeographicLib: the answer of the radius is calculated,
// since no filter of Directus asks the same (A-015, D-017).
const expectedFor = async (client: Client) => {
	const items = await client.request(
		readItems('occurrences', { fields: ['id', 'region', 'geometry'], limit: -1, sort: ['id'] }),
	);

	return items.filter(({ geometry }) => distanceOf(geometry) <= circle.meters);
};

// The error a request fails with, in the format of Directus.
const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error;
	}

	throw new Error('The request did not fail.');
};

describe('o raio no estilo do /items', () => {
	it('o capabilities mostra o nível do raio no banco da combinação', async () => {
		const { operations } = await as('admin').request(
			customEndpoint<Capabilities>({ path: '/geospatial/capabilities', method: 'GET' }),
		);

		expect(operations.radius).toEqual(
			postgis
				? { level: 'unindexed' }
				: { level: 'unavailable', reason: 'It does not run on the database in use yet.' },
		);
	});

	it.each([
		['sem o geo', { geo: undefined }, 'The geo parameter is required'],
		['com a distância negativa', { geo: { ...geo, distance: -1 } }, 'The geo parameter is off the contract'],
		['com o ponto fora da faixa', { geo: { ...geo, center: [-46.7, 91] } }, 'The geo parameter is off the contract'],
	])('%s, o pedido volta com o erro de query do Directus, antes do banco', async (_, params, reason) => {
		expect(await errorOf(radius(as('admin'), params))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY', reason: expect.stringContaining(reason) as string } }],
		});
	});

	it.runIf(postgis)('com a ordem, que o raio ainda não trata, o pedido volta recusado, e não ignorado', async () => {
		expect(await errorOf(radius(as('admin'), { sort: 'region' }))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY', reason: 'The radius does not take sort yet' } }],
		});
	});

	it.skipIf(postgis)(
		'onde o raio não roda, ele responde indisponível, com o motivo, antes de montar a query permitida',
		async () => {
			// The public cannot read the occurrences, and the chain would answer FORBIDDEN.
			expect(await errorOf(radius(as('public')))).toMatchObject({
				errors: [
					{
						extensions: {
							code: 'GEOSPATIAL_OPERATION_UNAVAILABLE',
							operation: 'radius',
							reason: 'It does not run on the database in use yet.',
						},
					},
				],
			});
		},
	);
});

describe.runIf(postgis)('o raio no PostGIS', () => {
	it.runIf(hasCustomPermissionRules())(
		'o raio da Maria devolve os itens do gabarito, com a geometria em GeoJSON, como o /items',
		async () => {
			const expected = await expectedFor(as('maria'));

			expect(await radius(as('maria'), { fields: 'id,region,geometry' })).toEqual(expected);
			expect(expected.length).toBeGreaterThan(0);
			expect(expected.every(({ region }) => region === 'south')).toBe(true);
		},
	);

	it('o raio do admin devolve o gabarito, com os pontos a 2 m da borda do lado certo', async () => {
		const expected = await expectedFor(as('admin'));
		const items = await radius(as('admin'), { fields: 'id,region,geometry', limit: -1 });

		expect(items).toEqual(expected);

		// The 12 points 2 m inside the edge, and none of the 12 points 2 m outside it.
		const nearTheEdge = expected.filter(({ geometry }) => Math.abs(distanceOf(geometry) - circle.meters) < 3);

		expect(nearTheEdge).toHaveLength(12);
	});

	it('uma coleção que não existe é recusada como no /items, como uma que o usuário não pode ler', async () => {
		const items = errorOf(as('admin').request(customEndpoint({ path: '/items/nowhere', method: 'GET' })));

		expect(await errorOf(radius(as('admin'), {}, 'nowhere'))).toMatchObject({
			errors: [{ extensions: { code: 'FORBIDDEN' } }],
		});
		expect(await items).toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
	});

	it('o field num campo que não é de geometria volta recusado, e quem não lê a coleção não fica sabendo', async () => {
		const notGeometry = { geo: { ...geo, field: 'region' } };

		expect(await errorOf(radius(as('admin'), notGeometry))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY', reason: 'The field region of occurrences is not a geometry' } }],
		});
		expect(await errorOf(radius(as('public'), notGeometry))).toMatchObject({
			errors: [{ extensions: { code: 'FORBIDDEN' } }],
		});
	});

	it('sem a geometria nos campos, os itens saem sem ela, como no /items', async () => {
		const items = await radius(as('admin'), { fields: 'id,region' });

		expect(items.length).toBeGreaterThan(0);
		expect(items.every((item) => Object.keys(item).sort().join() === 'id,region')).toBe(true);
	});

	it('o limit e o offset fatiam os itens do círculo, na ordem da chave primária', async () => {
		const expected = (await expectedFor(as('admin'))).map(({ id }) => id);
		const items = await radius(as('admin'), { fields: 'id', limit: 3, offset: 2 });

		expect(items.map(({ id }) => id)).toEqual(expected.slice(2, 5));
	});

	describe('num único pedido ao banco', () => {
		const collection = 'radius_once';
		const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

		// A collection only this test reads, so the statements of the other tests of the combination, which run at the
		// same time, never count.
		beforeAll(async () => {
			const admin = as('admin');

			await admin.request(
				createCollection({
					collection,
					schema: {},
					meta: {},
					fields: [
						{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
						{ field: 'geometry', type: 'geometry.Point', schema: {}, meta: {} },
						{ field: 'region', type: 'string', schema: {} },
					],
				}),
			);
			// The schema of the suite does not know the collection, so the items go by the path of /items.
			await admin.request(
				customEndpoint({
					path: `/items/${collection}`,
					method: 'POST',
					body: JSON.stringify([
						{ region: 'south', geometry: { type: 'Point', coordinates: circle.center } },
						{ region: 'north', geometry: { type: 'Point', coordinates: circle.center } },
					]),
				}),
			);

			if (hasCustomPermissionRules()) {
				const [policy] = await admin.request(readPolicies({ filter: { name: { _eq: 'South zone' } } }));

				await admin.request(
					createPermission({
						policy: policy?.id,
						collection,
						action: 'read',
						fields: ['*'],
						permissions: southZone,
					}),
				);
			}
		});

		const containerOf = () => {
			const container = databaseContainer();

			if (container === undefined) {
				throw new Error('The global setup did not hand over the container of the database.');
			}

			return container;
		};

		it('um geo fora do contrato volta antes de qualquer query na coleção', async () => {
			const container = containerOf();
			const before = await callsOn(container, `"${collection}"`);

			await expect(radius(user(), { geo: { ...geo, distance: -1 } }, collection)).rejects.toMatchObject({
				errors: [{ extensions: { code: 'INVALID_QUERY' } }],
			});
			expect(await callsOn(container, `"${collection}"`)).toBe(before);
		});

		it('a query permitida e a parte espacial chegam juntas, num SQL só', async () => {
			const container = containerOf();
			const before = await callsOn(container, `"${collection}"`);
			const items = await radius(user(), {}, collection);

			expect(items.length).toBeGreaterThan(0);
			expect(await callsOn(container, `"${collection}"`)).toBe(before + 1);
		});
	});
});

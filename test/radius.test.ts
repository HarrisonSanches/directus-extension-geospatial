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

// What a page of /items asks: the same parameters go to the radius.
interface Page {
	fields?: ('*' | keyof Occurrence)[];
	filter?: Record<string, unknown>;
	search?: string;
}

// An item as /items gives it: the fields the page asked, with the geometry null where a policy holds it back.
type Read = Partial<Omit<Occurrence, 'geometry'> & { geometry: Occurrence['geometry'] | null }>;

// The page as the radius takes it, with the fields joined as Directus reads them in the URL.
const paramsOf = ({ fields, ...page }: Page) => ({ ...page, ...(fields && { fields: fields.join(',') }) });

// What /items gives a user inside the circle, with the same page, by the distance of GeographicLib: the answer of the
// radius is calculated, since no filter of Directus asks the same (A-015, D-017). An item whose geometry a policy holds
// back is in no circle.
const expectedFor = async (client: Client, { fields = ['id', 'region', 'geometry'], ...page }: Page = {}) => {
	const asked = fields.includes('*') || fields.includes('geometry');
	const items: Read[] = await client.request(
		readItems('occurrences', { ...page, fields: asked ? fields : [...fields, 'geometry'], limit: -1, sort: ['id'] }),
	);

	return items
		.filter(({ geometry }) => geometry && distanceOf(geometry) <= circle.meters)
		.map(({ geometry, ...item }): Read => (asked ? { ...item, geometry } : item));
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

// The errors of a request that failed, without the response, to compare the radius with /items.
const errorsOf = async (request: Promise<unknown>) => {
	const error = await errorOf(request);

	return error instanceof Object && 'errors' in error ? error.errors : error;
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
		const nearTheEdge = expected.filter(
			({ geometry }) => geometry && Math.abs(distanceOf(geometry) - circle.meters) < 3,
		);

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

	describe('os outros papéis e o que a página manda (V-143)', () => {
		it('o público, que não lê as ocorrências, recebe do raio o mesmo erro do /items', async () => {
			const items = await errorsOf(as('public').request(readItems('occurrences')));

			expect(await errorsOf(radius(as('public')))).toEqual(items);
			expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
		});

		it.runIf(hasCustomPermissionRules())(
			'o raio do papel com duas políticas devolve a união das duas (V-22)',
			async () => {
				const page: Page = { fields: ['id', 'region', 'category', 'geometry'] };
				const expected = await expectedFor(as('twoPolicies'), page);

				expect(await radius(as('twoPolicies'), paramsOf(page))).toEqual(expected);
				// Items only one of the policies lets through: north and not theft, and theft and not north.
				expect(expected.some(({ region, category }) => region === 'north' && category !== 'theft')).toBe(true);
				expect(expected.some(({ region, category }) => region !== 'north' && category === 'theft')).toBe(true);
			},
		);

		it.runIf(hasCustomPermissionRules())(
			'o filtro, a busca e os campos da página mudam o raio da Maria como mudam o /items dela',
			async () => {
				const page: Page = {
					fields: ['id', 'category', 'status'],
					filter: { status: { _eq: 'open' } },
					search: 'theft',
				};
				const expected = await expectedFor(as('maria'), page);

				expect(await radius(as('maria'), paramsOf(page))).toEqual(expected);
				// The filter and the search leave out items of the circle the radius alone would bring.
				expect(expected.length).toBeGreaterThan(0);
				expect(expected.length).toBeLessThan((await expectedFor(as('maria'))).length);
				expect(expected.every(({ category, status }) => category === 'theft' && status === 'open')).toBe(true);
			},
		);

		describe.runIf(hasCustomPermissionRules())('com campos sem permissão', () => {
			it('com fields=*, o campo sem permissão fica fora do raio, como do /items', async () => {
				const page: Page = { fields: ['*'] };
				const expected = await expectedFor(as('withoutCategory'), page);

				expect(await radius(as('withoutCategory'), paramsOf(page))).toEqual(expected);
				expect(expected.length).toBeGreaterThan(0);
				expect(expected.every((item) => !('category' in item))).toBe(true);
			});

			it('pedido pelo nome, o campo sem permissão dá ao raio o mesmo erro do /items', async () => {
				const client = as('withoutCategory');
				const items = await errorsOf(client.request(readItems('occurrences', { fields: ['id', 'category'] })));

				expect(await errorsOf(radius(client, paramsOf({ fields: ['id', 'category'] })))).toEqual(items);
				expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			});

			it('sem permissão na geometria, o raio dá o erro do /items que a pede, e não um raio vazio', async () => {
				const client = as('withoutGeometry');
				const items = await errorsOf(client.request(readItems('occurrences', { fields: ['*', 'geometry'] })));

				expect(await errorsOf(radius(client))).toEqual(items);
				expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			});

			it('o item que uma política deixa ver sem a geometria fica fora do raio, sem vazar onde ele está', async () => {
				const client = as('geometryInPart');
				const visible: Read[] = await client.request(
					readItems('occurrences', { fields: ['id', 'region', 'geometry'], limit: -1 }),
				);
				const hidden = visible.filter(({ geometry }) => geometry === null).map(({ id }) => id);
				const inside = (await expectedFor(as('admin'))).map(({ id }) => id);

				// The /items shows items of the north without their geometry, and some of them are inside the circle: a radius
				// over the column itself would give their place away.
				expect(visible.some(({ region, geometry }) => region === 'north' && geometry === null)).toBe(true);
				expect(hidden.some((id) => inside.includes(id))).toBe(true);

				const items = await radius(client, { fields: 'id,region,geometry', limit: -1 });

				expect(items).toEqual(await expectedFor(client));
				expect(items.length).toBeGreaterThan(0);
				expect(hidden.filter((id) => items.some((item) => item.id === id))).toEqual([]);
			});
		});
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

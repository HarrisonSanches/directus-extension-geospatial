import {
	createCollection,
	createPermission,
	customEndpoint,
	deleteField,
	readItems,
	readPolicies,
} from '@directus/sdk';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import {
	as,
	type Client,
	databaseContainer,
	fetchAs,
	hasCustomPermissionRules,
	type Occurrence,
	type Role,
} from './directus.ts';
import { planOf, summaryOfPlan } from './measure/measure.ts';
import { callsOn, queryOn } from './postgres.ts';
import { circle, northZone, southZone, wgs84 } from './seed.ts';
import { runOnSqlite } from './sqlite.ts';
import {
	type Capabilities,
	type Item,
	type ItemsResponse,
	limitMaximum,
	type Position,
} from 'directus-geospatial-contract';

const postgis = combinations[inject('combination')].database.client === 'postgres';

// Directus 12 deactivates a collection, and 11.17 has no such state (V-173).
const deactivates = combinations[inject('combination')].directus.version.startsWith('12.');

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// The radius in the format of /items. The geo goes as an object, and the SDK of Directus sends it as JSON, as it sends
// any parameter it does not know (V-171). Each response goes through the contract (test/contract.ts).
const radius = (client: Client, params: Record<string, unknown> = {}, collection = 'occurrences') =>
	client.request(
		customEndpoint<Item[]>({ path: `/geospatial/items/${collection}`, method: 'GET', params: { geo, ...params } }),
	);

// The same radius by SEARCH, with the geo and the query of /items in the body (V-11).
const searched = (client: Client, body: Record<string, unknown>, collection = 'occurrences') =>
	client.request(
		customEndpoint<Item[]>({ path: `/geospatial/items/${collection}`, method: 'SEARCH', body: JSON.stringify(body) }),
	);

// A body past the 256 KB the extension takes, and under the 1 MB of Directus (V-10).
const largeBody = { geo, query: { search: 'x'.repeat(270_000) } };

const withoutGeo = (item: Item) => Object.fromEntries(Object.entries(item).filter(([name]) => name !== '$geo'));

// The items of the radius in the order of the primary key, as /items gives them, without the values the radius
// calculates, which /items does not have: the tests of parity compare what each user receives, and the order has tests
// of its own.
const inOrderOfKey = async (client: Client, params: Record<string, unknown> = {}, collection = 'occurrences') =>
	(await radius(client, { limit: limitMaximum, ...params, sort: 'id' }, collection)).map(withoutGeo);

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

// The container of the database, for the tests that read or write it directly (test/postgres.ts, test/sqlite.ts).
const containerOf = databaseContainer;

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

// The statement of the last radius of a collection, with its values, as the observer of the suite saw it reach the
// database (test/measure/observer/).
const statementOn = async (collection: string) => {
	const read = await as('admin').request(
		customEndpoint<{ statement: string } | null>({
			path: '/geospatial-test-observer/last',
			method: 'GET',
			params: { collection },
		}),
	);

	if (read === null) {
		throw new Error('The observer saw no radius of the collection.');
	}

	return read.statement;
};

// The columns Directus never creates, which a test makes by SQL from the one Directus creates, a geometry in 4326 (V-25):
// the type, how the rows go to it, and how a statement reads it in geography.
const columns = {
	utm: {
		type: 'geometry(Point, 31983)',
		using: 'ST_Transform(geometry, 31983)',
		geography: 'ST_Transform(geometry, 4326)::geography',
	},
	geography: { type: 'geography(Point, 4326)', using: 'geometry::geography', geography: 'geometry' },
	// A geometry with no SRID declared, whose rows keep the one Directus writes them in.
	undeclared: { type: 'geometry', using: 'geometry', geography: 'geometry::geography' },
};

type Column = (typeof columns)[keyof typeof columns];

const changeColumn = (collection: string, { type, using }: Column) =>
	`alter table ${collection} alter column geometry type ${type} using ${using}`;

// A collection only one test reads, as Directus creates it, with the geometry in 4326.
const createCollectionOf = (collection: string) =>
	as('admin').request(
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

// A permission to read a collection, in a policy of the seed, found by its name.
const permit = async (collection: string, policy: string, permissions: Record<string, unknown>, fields = ['*']) => {
	const admin = as('admin');
	const [found] = await admin.request(readPolicies({ filter: { name: { _eq: policy } } }));

	await admin.request(createPermission({ policy: found?.id, collection, action: 'read', fields, permissions }));
};

const distanceBetween = ([fromLongitude, fromLatitude]: Position, [toLongitude, toLatitude]: Position) => {
	const { s12 } = wgs84.Inverse(fromLatitude, fromLongitude, toLatitude, toLongitude);

	if (s12 === undefined) {
		throw new Error('GeographicLib did not return the distance.');
	}

	return s12;
};

const isPoint = (value: unknown): value is Occurrence['geometry'] =>
	value instanceof Object && 'type' in value && value.type === 'Point' && 'coordinates' in value;

// A radius against its gabarito where PostGIS converts the geometry on the way out: the same items, in the same order,
// each with the geometry a point in 4326 less than a billionth of a degree from the one of the gabarito, which is under
// a millimeter.
const expectIn4326 = (items: Record<string, unknown>[], expected: Read[]) => {
	expect(items.map((item) => Object.keys(item))).toEqual(expected.map((item) => Object.keys(item)));

	for (const [index, { geometry, ...rest }] of expected.entries()) {
		const item = items[index] ?? {};
		const [longitude, latitude] = isPoint(item.geometry) ? item.geometry.coordinates : [];

		expect(Object.fromEntries(Object.entries(item).filter(([name]) => name !== 'geometry'))).toEqual(rest);
		expect(longitude).toBeCloseTo(geometry?.coordinates[0] ?? Number.NaN, 9);
		expect(latitude).toBeCloseTo(geometry?.coordinates[1] ?? Number.NaN, 9);
	}
};

describe('o raio no estilo do /items', () => {
	it('o capabilities mostra o nível do raio no banco da combinação', async () => {
		const { operations } = await as('admin').request(
			customEndpoint<Capabilities>({ path: '/geospatial/capabilities', method: 'GET' }),
		);

		// In SQLite, the circle in the database, and the distance and the order in the server (D-052).
		expect(operations.radius).toEqual({ level: postgis ? 'indexed' : 'capped' });
	});

	it.each([
		['sem o geo', { geo: undefined }, 'The geo parameter is required'],
		['com a distância negativa', { geo: { ...geo, distance: -1 } }, 'The geo parameter is off the contract'],
		['com o ponto fora da faixa', { geo: { ...geo, center: [-46.7, 91] } }, 'The geo parameter is off the contract'],
	])('%s, o pedido volta com o erro de entrada da extensão, antes do banco', async (_, params, reason) => {
		expect(await errorOf(radius(as('admin'), params))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_INVALID_INPUT', reason: expect.stringContaining(reason) as string } }],
		});
	});

	it('com o centro fora da faixa, o erro diz onde, e não repete os valores enviados', async () => {
		const error = await errorOf(radius(as('admin'), { geo: { ...geo, center: [-46.123456789, 91.987654321] } }));

		expect(error).toMatchObject({
			errors: [
				{
					extensions: {
						code: 'GEOSPATIAL_INVALID_INPUT',
						reason: expect.stringContaining('/center/1 must be <= 90') as string,
					},
				},
			],
		});
		expect(JSON.stringify(error)).not.toMatch(/46\.123456789|91\.987654321/);
	});

	it.each([
		['acima de 256 KB', largeBody, 'GEOSPATIAL_LIMIT_EXCEEDED', { limit: 262_144 }],
		['sem o geo', { query: {} }, 'GEOSPATIAL_INVALID_INPUT', {}],
		['com o geo em JSON, como na URL', { geo: JSON.stringify(geo) }, 'GEOSPATIAL_INVALID_INPUT', {}],
	])('o corpo do SEARCH %s volta com o erro da extensão, antes do banco', async (_, body, code, extensions) => {
		expect(await errorOf(searched(as('admin'), body))).toMatchObject({
			errors: [{ extensions: { code, ...extensions } }],
		});
	});

	it('com a ordem por uma relação, que o raio ainda não trata, o pedido volta recusado, e não ignorado', async () => {
		expect(await errorOf(radius(as('admin'), { sort: 'author.name' }))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY', reason: 'The radius does not take sort by a relation yet' } }],
		});
	});
});

describe('o raio no banco', () => {
	it.runIf(hasCustomPermissionRules())(
		'o raio da Maria devolve os itens do gabarito, com a geometria em GeoJSON, como o /items',
		async () => {
			const expected = await expectedFor(as('maria'));

			expect(await inOrderOfKey(as('maria'), { fields: 'id,region,geometry' })).toEqual(expected);
			expect(expected.length).toBeGreaterThan(0);
			expect(expected.every(({ region }) => region === 'south')).toBe(true);
		},
	);

	it('o raio do admin devolve o gabarito, com os pontos a 2 m da borda do lado certo', async () => {
		const expected = await expectedFor(as('admin'));
		const items = await inOrderOfKey(as('admin'), { fields: 'id,region,geometry' });

		expect(items).toEqual(expected);

		// The 12 points 2 m inside the edge, and none of the 12 points 2 m outside it.
		const nearTheEdge = expected.filter(
			({ geometry }) => geometry && Math.abs(distanceOf(geometry) - circle.meters) < 3,
		);

		expect(nearTheEdge).toHaveLength(12);
	});

	describe('o SEARCH, com a consulta no corpo (V-11)', () => {
		const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));
		const filter = { category: { _eq: 'theft' } };

		it('dá o mesmo raio que o GET com a consulta na URL', async () => {
			const fromGet = await radius(user(), { fields: 'id,region,geometry', filter, sort: '-id', limit: 5 });
			const fromSearch = await searched(user(), {
				geo,
				query: { fields: ['id', 'region', 'geometry'], filter, sort: ['-id'], limit: 5 },
			});

			expect(fromSearch).toEqual(fromGet);
			expect(fromGet.length).toBeGreaterThan(1);
		});

		it('sem a query no corpo, vale a da URL, como no SEARCH do /items', async () => {
			const fromGet = await radius(user(), { fields: 'id', limit: 3 });
			const fromSearch = await user().request(
				customEndpoint<Item[]>({
					path: '/geospatial/items/occurrences',
					method: 'SEARCH',
					params: { fields: 'id', limit: 3 },
					body: JSON.stringify({ geo }),
				}),
			);

			expect(fromSearch).toEqual(fromGet);
		});

		it.runIf(hasCustomPermissionRules())(
			'a query do corpo passa pelo Directus: o campo sem permissão dá o mesmo erro do SEARCH do /items',
			async () => {
				const client = as('withoutCategory');
				const query = { fields: ['id', 'category'] };
				const items = await errorsOf(
					client.request(
						customEndpoint({ path: '/items/occurrences', method: 'SEARCH', body: JSON.stringify({ query }) }),
					),
				);

				expect(await errorsOf(searched(client, { geo, query }))).toEqual(items);
				expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			},
		);
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
			errors: [
				{
					extensions: {
						code: 'GEOSPATIAL_INVALID_INPUT',
						reason: 'The field region of occurrences is not a geometry',
					},
				},
			],
		});
		expect(await errorOf(radius(as('public'), notGeometry))).toMatchObject({
			errors: [{ extensions: { code: 'FORBIDDEN' } }],
		});
	});

	it('sem a geometria nos campos, os itens saem sem ela, como no /items', async () => {
		const items = await radius(as('admin'), { fields: 'id,region' });

		expect(items.length).toBeGreaterThan(0);
		expect(items.every((item) => Object.keys(item).sort().join() === '$geo,id,region')).toBe(true);
	});

	it('o limit, o offset e a página fatiam os itens do círculo, na ordem da lista', async () => {
		const ids = async (page: Record<string, unknown>) =>
			(await radius(as('admin'), { fields: 'id', ...page })).map(({ id }) => id);
		const all = await ids({ limit: limitMaximum });

		expect(await ids({ limit: 3, offset: 2 })).toEqual(all.slice(2, 5));
		expect(await ids({ limit: 3, page: 2 })).toEqual(all.slice(3, 6));
		expect(all).toHaveLength((await expectedFor(as('admin'))).length);
	});

	describe('a distância no $geo e a ordem natural (F02-10)', () => {
		const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

		// The distance of an item, from its geometry in GeoJSON, by GeographicLib.
		const geodesicOf = ({ geometry }: Item) => (isPoint(geometry) ? distanceOf(geometry) : Number.NaN);

		it('cada item traz no $geo a distância da GeographicLib, a 1 mm, e a lista vem pela distância', async () => {
			const expected = await expectedFor(user());
			const items = await radius(user(), { fields: 'id,region,geometry', limit: limitMaximum });

			expect(items.map(({ id }) => id).sort((a, b) => Number(a) - Number(b))).toEqual(expected.map(({ id }) => id));

			for (const item of items) {
				expect(Math.abs((item.$geo.distance ?? Number.NaN) - geodesicOf(item))).toBeLessThan(0.001);
			}

			// The order of the distance, with a tie by the primary key, and that of GeographicLib, within its millimeter.
			const ordered = [...items].sort(
				(a, b) => (a.$geo.distance ?? 0) - (b.$geo.distance ?? 0) || Number(a.id) - Number(b.id),
			);

			expect(items).toEqual(ordered);
			expect(items.slice(1).every((item, index) => geodesicOf(item) >= geodesicOf(items[index] ?? item) - 0.002)).toBe(
				true,
			);
			expect(items.length).toBeGreaterThan(1);
		});

		it('os itens à mesma distância vêm pela chave primária', async () => {
			const collection = 'radius_ties';
			const [longitude, latitude] = circle.center;
			const at = (meters: number) => {
				const { lon2, lat2 } = wgs84.Direct(latitude, longitude, 0, meters);

				return { type: 'Point', coordinates: [lon2, lat2] };
			};

			await createCollectionOf(collection);
			// Two places, at 1 km and at 2 km, with their items interleaved by the key.
			await as('admin').request(
				customEndpoint({
					path: `/items/${collection}`,
					method: 'POST',
					body: JSON.stringify(
						[1, 2, 3, 4, 5, 6].map((id) => ({ id, region: 'south', geometry: at(id % 2 === 1 ? 1_000 : 2_000) })),
					),
				}),
			);

			const items = await radius(as('admin'), { fields: 'id' }, collection);

			expect(items.map(({ id }) => id)).toEqual([1, 3, 5, 2, 4, 6]);
			expect(new Set(items.slice(0, 3).map(({ $geo }) => $geo.distance)).size).toBe(1);
		});

		it.each(['status', '-status'] as const)(
			'com sort=%s, a lista segue a ordem da página, como a do /items, e termina na chave',
			async (sort) => {
				const page: Page = { fields: ['id', 'status'] };
				const descending = sort.startsWith('-');
				const expected = (await expectedFor(user(), page)).sort(
					(a, b) =>
						(descending ? -1 : 1) * String(a.status).localeCompare(String(b.status)) || Number(a.id) - Number(b.id),
				);
				const items = (await radius(user(), { ...paramsOf(page), sort, limit: limitMaximum })).map(withoutGeo);

				expect(items).toEqual(expected);

				// The same order of /items, which leaves the tie as it comes.
				const fromItems = await user().request(
					readItems('occurrences', { fields: ['id', 'status', 'geometry'], sort: [sort], limit: -1 }),
				);
				const inside = new Set(expected.map(({ id }) => id));

				expect(fromItems.filter(({ id }) => inside.has(id)).map(({ status }) => status)).toEqual(
					expected.map(({ status }) => status),
				);
				expect(new Set(expected.map(({ status }) => status)).size).toBeGreaterThan(1);
			},
		);

		it.runIf(hasCustomPermissionRules())(
			'o item cujo campo de ordem uma política esconde ordena como vazio, e não revela o valor pela posição (V-179)',
			async () => {
				const client = as('statusInPart');
				const page: Page = { fields: ['id', 'region', 'status'] };
				// Postgres puts the empty ones last in an ascending order, and SQLite first.
				const emptyLast = postgis ? 1 : -1;
				const expected = (await expectedFor(client, page)).sort(
					(a, b) =>
						emptyLast * (Number(typeof a.status !== 'string') - Number(typeof b.status !== 'string')) ||
						String(a.status).localeCompare(String(b.status)) ||
						Number(a.id) - Number(b.id),
				);
				const items = (await radius(client, { ...paramsOf(page), sort: 'status', limit: limitMaximum })).map(
					withoutGeo,
				);

				expect(items).toEqual(expected);
				expect(expected.some(({ region, status }) => region === 'north' && typeof status !== 'string')).toBe(true);

				// /items orders by the column itself, so an item of the north, whose status the user does not see, lands
				// among the others by the status it has.
				const fromItems = await client.request(
					readItems('occurrences', { fields: ['id', 'region', 'status'], sort: ['status'], limit: -1 }),
				);
				const north = fromItems.map(({ region }) => region === 'north');

				expect(north.indexOf(true)).toBeLessThan(north.lastIndexOf(false));
			},
		);

		it.runIf(hasCustomPermissionRules())(
			'o sort por um campo sem permissão dá ao raio o mesmo erro do /items',
			async () => {
				const client = as('withoutCategory');
				const items = await errorsOf(client.request(readItems('occurrences', { sort: ['category'] })));

				expect(await errorsOf(radius(client, { sort: 'category' }))).toEqual(items);
				expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			},
		);

		it('o campo pedido só para ordenar fica fora dos itens', async () => {
			const [item] = await radius(user(), { fields: 'id', sort: '-status', limit: 1 });

			expect(Object.keys(item ?? {}).sort()).toEqual(['$geo', 'id']);
		});

		it.each([
			['acima do máximo', 1001, 'must be <= 1000'],
			['o -1, que no /items traz todos', -1, 'must be >= 1'],
		])('o limit %s volta com o erro de query do Directus, com o motivo, antes do banco', async (_, limit, reason) => {
			expect(await errorOf(radius(user(), { limit }))).toMatchObject({
				errors: [{ extensions: { code: 'INVALID_QUERY', reason: `The limit is off the contract: ${reason}` } }],
			});
		});
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

				expect(await inOrderOfKey(as('twoPolicies'), paramsOf(page))).toEqual(expected);
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

				expect(await inOrderOfKey(as('maria'), paramsOf(page))).toEqual(expected);
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

				expect(await inOrderOfKey(as('withoutCategory'), paramsOf(page))).toEqual(expected);
				expect(expected.length).toBeGreaterThan(0);
				expect(expected.every((item) => !('category' in item))).toBe(true);
			});

			it.each([['*'], ['region']] as const)(
				'com fields=%s, a chave primária que a política não libera fica fora do raio, como do /items (V-183)',
				async (fields) => {
					const client = as('withoutKey');
					const items: Record<string, unknown>[] = await client.request(readItems('occurrences', { fields: [fields] }));
					const radiusItems = await radius(client, { fields });

					expect(radiusItems.map((item) => Object.keys(withoutGeo(item)).sort())).toEqual(
						items.slice(0, radiusItems.length).map((item) => Object.keys(item).sort()),
					);
					expect(radiusItems.length).toBeGreaterThan(0);
					expect(radiusItems.every((item) => !('id' in item))).toBe(true);
				},
			);

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

				const items = await inOrderOfKey(client, { fields: 'id,region,geometry' });

				expect(items).toEqual(await expectedFor(client));
				expect(items.length).toBeGreaterThan(0);
				expect(hidden.filter((id) => items.some((item) => item.id === id))).toEqual([]);
			});
		});
	});

	describe('as coleções que o /items recusa além das permissões (V-173)', () => {
		// A geometry field only this test adds to a collection of the system, by a name no other query reads.
		const column = 'radius_location';
		const itemsOf = (client: Client, collection: string) =>
			errorsOf(client.request(customEndpoint({ path: `/items/${collection}`, method: 'GET' })));

		afterAll(async () => {
			await as('admin').request(deleteField('directus_users', column));
		});

		it('uma coleção do sistema é recusada como no /items, também ao admin', async () => {
			const items = await itemsOf(as('admin'), 'directus_users');

			expect(await errorsOf(radius(as('admin'), {}, 'directus_users'))).toEqual(items);
			expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
		});

		it.runIf(postgis)(
			'com um campo de geometria acrescentado, a coleção do sistema segue recusada, sem query nela',
			async () => {
				const admin = as('admin');

				// The schema of the suite does not know the collection, so the field goes by the path of /fields.
				await admin.request(
					customEndpoint({
						path: '/fields/directus_users',
						method: 'POST',
						body: JSON.stringify({ field: column, type: 'geometry.Point', schema: {}, meta: {} }),
					}),
				);

				const container = containerOf();
				const before = await callsOn(container, `"${column}"`);

				expect(await errorsOf(radius(admin, {}, 'directus_users'))).toEqual(await itemsOf(admin, 'directus_users'));
				expect(await callsOn(container, `"${column}"`)).toBe(before);
			},
		);

		it.runIf(deactivates)(
			'no 12, a coleção inativa é recusada como no /items: inativa a quem a lê, proibida a quem não lê',
			async () => {
				const collection = 'radius_inactive';
				const admin = as('admin');

				await admin.request(
					createCollection({
						collection,
						schema: {},
						meta: {},
						fields: [
							{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
							{ field: 'geometry', type: 'geometry.Point', schema: {}, meta: {} },
						],
					}),
				);

				const readers: Role[] = ['admin', 'public'];

				if (hasCustomPermissionRules()) {
					const [policy] = await admin.request(readPolicies({ filter: { name: { _eq: 'South zone' } } }));

					await admin.request(
						createPermission({ policy: policy?.id, collection, action: 'read', fields: ['*'], permissions: southZone }),
					);
					readers.push('maria');
				}

				// Directus deactivates a collection through its meta, as it does past the collections of its tier.
				await admin.request(
					customEndpoint({
						path: `/collections/${collection}`,
						method: 'PATCH',
						body: JSON.stringify({ meta: { status: 'inactive' } }),
					}),
				);

				for (const reader of readers) {
					expect(await errorsOf(radius(as(reader), {}, collection))).toEqual(await itemsOf(as(reader), collection));
				}

				expect(await itemsOf(admin, collection)).toMatchObject([{ extensions: { code: 'COLLECTION_INACTIVE' } }]);
				expect(await itemsOf(as('public'), collection)).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			},
		);
	});

	describe('os valores como o /items os entrega (V-173)', () => {
		const collection = 'radius_values';
		const point = { type: 'Point', coordinates: circle.center };

		// A field of each kind Directus processes as it reads, inside the circle. Only this test reads the collection.
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
						{ field: 'secret', type: 'hash', schema: {}, meta: { special: ['hash', 'conceal'] } },
						{ field: 'flag', type: 'boolean', schema: {}, meta: { special: ['cast-boolean'] } },
						{ field: 'details', type: 'json', schema: {}, meta: { special: ['cast-json'] } },
						{ field: 'tags', type: 'csv', schema: {}, meta: { special: ['cast-csv'] } },
						{ field: 'stamped_at', type: 'timestamp', schema: {}, meta: {} },
						{ field: 'happened_at', type: 'dateTime', schema: {}, meta: {} },
						{ field: 'day', type: 'date', schema: {}, meta: {} },
						{ field: 'hour', type: 'time', schema: {}, meta: {} },
					],
				}),
			);
			await admin.request(
				customEndpoint({
					path: `/items/${collection}`,
					method: 'POST',
					body: JSON.stringify([
						{
							geometry: point,
							secret: 'swordfish',
							flag: true,
							details: { level: 2, tags: ['a'] },
							tags: ['a', 'b'],
							stamped_at: '2026-09-01T10:00:00Z',
							happened_at: '2026-09-01T10:00:00',
							day: '2026-09-01',
							hour: '10:00:00',
						},
						{ geometry: point, flag: false },
					]),
				}),
			);
		});

		it('com fields=*, o raio devolve os mesmos valores do /items, com o campo escondido e cada tipo convertido', async () => {
			const items = await as('admin').request(
				customEndpoint<Item[]>({ path: `/items/${collection}`, method: 'GET', params: { sort: 'id', limit: -1 } }),
			);

			expect(await inOrderOfKey(as('admin'), { fields: '*' }, collection)).toEqual(items);
			// The values /items gives are not the ones the database holds.
			expect(items[0]).toMatchObject({ secret: '**********', tags: ['a', 'b'], day: '2026-09-01' });
		});
	});

	// A column in another SRID, a geography and a geometry with no SRID declared, which Directus never creates: Directus
	// creates the collection, and the test changes the type of the column by SQL, in the container of the suite (V-25).
	// Each one copies the occurrences, with their ids, so the gabarito of /items over them holds.
	describe.runIf(postgis).each([
		{ collection: 'radius_utm', name: 'em SIRGAS 2000 / UTM 23S', column: columns.utm },
		{ collection: 'radius_geography', name: 'geography', column: columns.geography },
		{ collection: 'radius_undeclared', name: 'geometry sem SRID declarado', column: columns.undeclared },
	])('numa coluna $name (D-007)', ({ collection, column }) => {
		const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

		beforeAll(async () => {
			await createCollectionOf(collection);
			await queryOn(containerOf(), [
				`insert into ${collection} (id, region, geometry) select id, region, geometry from occurrences`,
				changeColumn(collection, column),
			]);

			if (hasCustomPermissionRules()) {
				await permit(collection, 'South zone', southZone);
				await permit(collection, 'South zone with geometry', southZone);
				await permit(collection, 'North zone without geometry', northZone, ['id', 'region']);
			}
		});

		it('o raio bate com o gabarito, com a geometria em 4326, e o SRID vem da coluna', async () => {
			const expected = await expectedFor(user());

			expectIn4326(await inOrderOfKey(user(), { fields: 'id,region,geometry' }, collection), expected);
			expect(expected.length).toBeGreaterThan(0);
		});

		it.runIf(hasCustomPermissionRules())(
			'o item que uma política deixa ver sem a geometria segue fora do raio, também com a geometria convertida',
			async () => {
				const client = as('geometryInPart');
				const expected = await expectedFor(client);
				const items = await inOrderOfKey(client, { fields: 'id,region,geometry' }, collection);

				expectIn4326(items, expected);
				expect(items.some(({ region }) => region === 'north')).toBe(false);
				expect(items.length).toBeGreaterThan(0);
			},
		);

		it.runIf(column === columns.utm)(
			'o /items devolve a coluna em UTM nos metros dela, como se fossem graus, e o raio a devolve em 4326 (V-178)',
			async () => {
				const [item] = await as('admin').request(
					customEndpoint<Item[]>({ path: `/items/${collection}`, method: 'GET', params: { sort: 'id', limit: 1 } }),
				);
				const [inRadius] = await radius(as('admin'), { fields: 'id,geometry' }, collection);

				expect(isPoint(item?.geometry) && item.geometry.coordinates[0]).toBeGreaterThan(180);
				expect(isPoint(inRadius?.geometry) && Math.abs(inRadius.geometry.coordinates[0])).toBeLessThanOrEqual(180);
			},
		);
	});

	// Points 1 m inside and 1 m outside the edge of a circle, every 15°, by GeographicLib.
	const edgeOf = ([longitude, latitude]: Position, distance: number) =>
		Array.from({ length: 24 }, (_, index) => index * 15).flatMap((azimuth) =>
			[distance - 1, distance + 1].map((meters): Position => {
				const { lon2, lat2 } = wgs84.Direct(latitude, longitude, azimuth, meters);

				if (lon2 === undefined || lat2 === undefined) {
					throw new Error('GeographicLib did not return the point.');
				}

				return [lon2, lat2];
			}),
		);

	// The points of a collection only one test reads, by SQL, in 4326, with the ids in their order.
	const insertPoints = (collection: string, points: Position[]) =>
		`insert into ${collection} (id, region, geometry) values ${points
			.map(
				([longitude, latitude], index) =>
					`(${String(index + 1)}, 'south', ST_SetSRID(ST_MakePoint(${String(longitude)}, ${String(latitude)}), 4326))`,
			)
			.join(', ')}`;

	const idsInRadius = async (collection: string, center: Position, distance: number) =>
		(await inOrderOfKey(as('admin'), { fields: 'id', geo: { ...geo, center, distance } }, collection)).map(
			({ id }) => id,
		);

	// The box in the SRID of a column, as it went with the statement of the last radius of a collection.
	const boxIn = (srid: number) => new RegExp(String.raw`&& ST_MakeEnvelope\((-?[\d.]+, ){4}${String(srid)}\)`);

	describe.runIf(postgis)('a caixa convertida para a UTM (D-007)', () => {
		const collection = 'radius_utm_edges';

		// São Paulo, 2° west of the central meridian of the zone, and Manaus, 15° west of it.
		const centers: Position[] = [circle.center, [-60.02, -3.1]];
		const distances = [1_000, 100_000, 2_000_000];
		const points = centers.flatMap((center) => distances.flatMap((distance) => edgeOf(center, distance)));

		const insideOf = (center: Position, distance: number) =>
			points.flatMap((point, index) => (distanceBetween(center, point) <= distance ? [index + 1] : []));

		beforeAll(async () => {
			await createCollectionOf(collection);
			await queryOn(containerOf(), [insertPoints(collection, points), changeColumn(collection, columns.utm)]);
		});

		it.each(centers.flatMap((center) => distances.map((distance) => [center, distance] as const)))(
			'em volta de %j, com %d m, a caixa guarda os pontos a 1 m dentro da borda, e a distância deixa os de fora',
			async (center, distance) => {
				const expected = insideOf(center, distance);

				expect(await idsInRadius(collection, center, distance)).toEqual(expected);
				expect(expected.length).toBeGreaterThanOrEqual(24);
				// The box went with the statement, so the points inside got through it.
				expect(await statementOn(collection)).toMatch(boxIn(31983));
			},
		);

		it('o círculo que chega ao polo vira uma faixa de todas as longitudes, que a UTM converte, e bate com o gabarito', async () => {
			const expected = insideOf(circle.center, 7_700_000);

			expect(await idsInRadius(collection, circle.center, 7_700_000)).toEqual(expected);
			expect(expected).toHaveLength(points.length);
			expect(await statementOn(collection)).toMatch(boxIn(31983));
		});

		it('a faixa que cruza o equador a 90° do meridiano central, onde a UTM não tem valor, vai sem a caixa e bate com o gabarito', async () => {
			const center: Position = [-46.7, -46];
			const expected = insideOf(center, 4_800_000);

			expect(await idsInRadius(collection, center, 4_800_000)).toEqual(expected);
			expect(expected.length).toBeGreaterThan(0);
			expect(await statementOn(collection)).not.toContain('ST_MakeEnvelope');
		});
	});

	// A projection PROJ only approximates far from its center: the transverse Mercator of the zone by the series of
	// Snyder, an SRID of its own, which only the database container of the suite has. The points were projected by the
	// exact one, as another system would project them, and are read by the approximate one.
	describe.runIf(postgis)('a caixa numa projeção aproximada (D-007)', () => {
		const collection = 'radius_approx';
		const srid = 990_001;
		const far: Position[] = [
			[-20, -23],
			[0, -23],
		];
		const points = [circle.center, ...far].flatMap((center) =>
			edgeOf(center, center === circle.center ? circle.meters : 1_000_000),
		);

		// What the distance alone keeps, over the points as the column gives them back in 4326.
		const insideOf = async (center: Position, distance: number) => {
			const ids = await queryOn(
				containerOf(),
				`select id from ${collection} where ST_DWithin(ST_Transform(geometry, 4326)::geography, ST_SetSRID(ST_MakePoint(${center.map(String).join(', ')}), 4326)::geography, ${String(distance)}) order by id`,
			);

			return ids === '' ? [] : ids.split('\n').map(Number);
		};

		beforeAll(async () => {
			await createCollectionOf(collection);
			await queryOn(containerOf(), [
				`insert into spatial_ref_sys (srid, proj4text) values (${String(srid)}, '+proj=tmerc +approx +lat_0=0 +lon_0=-45 +k=0.9996 +x_0=500000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs') on conflict do nothing`,
				insertPoints(collection, points),
				changeColumn(collection, columns.utm),
				changeColumn(collection, {
					type: `geometry(Point, ${String(srid)})`,
					using: `ST_SetSRID(geometry, ${String(srid)})`,
					geography: '',
				}),
			]);
		});

		it('perto do centro dela, a borda volta ao lugar, e a caixa vai', async () => {
			const expected = await insideOf(circle.center, circle.meters);

			expect(await idsInRadius(collection, circle.center, circle.meters)).toEqual(expected);
			expect(expected).toHaveLength(24);
			expect(await statementOn(collection)).toMatch(boxIn(srid));
		});

		it.each(far)(
			'em volta de [%d, %d], longe do centro, a borda volta a quilômetros de onde estava, e o raio vai sem a caixa (V-178)',
			async (...center) => {
				const expected = await insideOf(center, 1_000_000);

				expect(await idsInRadius(collection, center, 1_000_000)).toEqual(expected);
				expect(expected.length).toBeGreaterThan(0);
				expect(await statementOn(collection)).not.toContain('ST_MakeEnvelope');
			},
		);
	});

	describe.runIf(postgis).each([
		{ collection: 'radius_indexed', name: 'geometry em 4326, como o Directus a cria', column: undefined },
		{ collection: 'radius_indexed_utm', name: 'em SIRGAS 2000 / UTM 23S', column: columns.utm },
		{ collection: 'radius_indexed_geography', name: 'geography', column: columns.geography },
	])('o índice conferido, não suposto, numa coluna $name (D-049)', ({ collection, column }) => {
		const index = `${collection}_geometry_gist`;
		const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

		// A collection only this test reads, with points enough for Postgres to weigh the index: 20,000 around São Paulo,
		// half of them in the south zone, spread as in the measurements (F02-07), with the GiST the extension offers (§7.6).
		beforeAll(async () => {
			await createCollectionOf(collection);

			if (hasCustomPermissionRules()) {
				await permit(collection, 'South zone', southZone);
			}

			await queryOn(containerOf(), [
				'select setseed(0.5)',
				`insert into ${collection} (region, geometry)
				select case when random() < 0.5 then 'south' else 'north' end, ST_SetSRID(ST_MakePoint(
					-46.63 + 0.5 * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()),
					-23.55 + 0.5 * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())
				), 4326)
				from generate_series(1, 20000)`,
				...(column === undefined ? [] : [changeColumn(collection, column)]),
				`create index ${index} on ${collection} using gist (geometry)`,
				`analyze ${collection}`,
			]);
		});

		it('o plano do raio passa pelo GiST, e não varre a tabela', async () => {
			const container = containerOf();
			const items = await radius(user(), { fields: 'id', limit: limitMaximum }, collection);
			const { reads } = summaryOfPlan(await planOf(container, await statementOn(collection)));

			expect(reads.some((read) => read.includes(index))).toBe(true);
			expect(reads.filter((read) => read.includes('Seq Scan') || read.includes(`${collection}_pkey`))).toEqual([]);

			// The box only discards candidates: the circle keeps every item the distance alone keeps.
			const rule = hasCustomPermissionRules() ? "region = 'south' and " : '';
			const inside = await queryOn(
				container,
				`select count(*) from ${collection} where ${rule}ST_DWithin(${column?.geography ?? 'geometry::geography'}, ST_SetSRID(ST_MakePoint(${circle.center.map(String).join(', ')}), 4326)::geography, ${String(circle.meters)})`,
			);

			expect(items.length).toBeGreaterThan(0);
			expect(items).toHaveLength(Number(inside));
		});

		it.runIf(column === undefined)(
			'sem o limit, o raio devolve a página padrão do /items, e não o círculo inteiro (A-044)',
			async () => {
				const ids = async (page: Record<string, unknown>) =>
					(await radius(user(), { fields: 'id', ...page }, collection)).map(({ id }) => id);
				const all = await ids({ limit: limitMaximum });
				const items = await user().request(
					customEndpoint<Item[]>({ path: `/items/${collection}`, method: 'GET', params: { fields: 'id' } }),
				);

				expect(all.length).toBeGreaterThan(items.length);
				expect(await ids({})).toEqual(all.slice(0, items.length));
				expect(items).toHaveLength(100);
			},
		);
	});

	describe.runIf(postgis)('num único pedido ao banco', () => {
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

		// Each input off the contract, by the GET and by the SEARCH, with the code it comes back with. The field that is not
		// a geometry is refused after the chain, which reads the permissions in the database of Directus, and never the
		// collection (A-040).
		it.each([
			['o centro fora da faixa', () => radius(user(), { geo: { ...geo, center: [-46.7, 91] } }, collection), 400],
			['o geo fora do contrato', () => radius(user(), { geo: { ...geo, distance: -1 } }, collection), 400],
			['o campo que não é de geometria', () => radius(user(), { geo: { ...geo, field: 'region' } }, collection), 400],
			['o corpo acima de 256 KB', () => searched(user(), largeBody, collection), 413],
			['o corpo fora do contrato', () => searched(user(), { query: {} }, collection), 400],
		])('%s volta com o código da extensão, sem nenhuma query na coleção', async (_, request, status) => {
			const container = containerOf();
			const before = await callsOn(container, `"${collection}"`);
			const error = await errorOf(request());

			expect(error).toMatchObject({
				errors: [{ extensions: { code: status === 413 ? 'GEOSPATIAL_LIMIT_EXCEEDED' : 'GEOSPATIAL_INVALID_INPUT' } }],
			});
			expect(await callsOn(container, `"${collection}"`)).toBe(before);
		});

		it.each([
			['o GET', () => radius(user(), {}, collection)],
			['o SEARCH', () => searched(user(), { geo, query: { fields: ['*'] } }, collection)],
		])('pelo %s, a query permitida e a parte espacial chegam juntas, num SQL só', async (_, request) => {
			const container = containerOf();
			const before = await callsOn(container, `"${collection}"`);
			const items = await request();

			expect(items.length).toBeGreaterThan(0);
			expect(await callsOn(container, `"${collection}"`)).toBe(before + 1);
		});
	});
});

// In SQLite, the circle in the database, and the distance and the natural order in the server, which takes at most
// 50,000 items, and SpatiaLite only measures points there (D-052, V-180).
describe.skipIf(postgis)('o raio no SQLite, com limite (D-052)', () => {
	describe('acima do limite do servidor', () => {
		const collection = 'radius_capped';
		const [longitude, latitude] = circle.center;

		// The radius of the collection as the admin asks it, with the whole body, the meta included.
		const capped = async (params: Record<string, string>, distance = circle.meters) => {
			const query = new URLSearchParams({ geo: JSON.stringify({ ...geo, distance }), fields: 'id', ...params });
			const response = await fetchAs('admin', `/geospatial/items/${collection}?${query.toString()}`);

			return (await response.json()) as ItemsResponse;
		};

		// 55,000 points in a grid from the center to the northeast, about 10 m apart and up to 6 km away, all inside the
		// circle. By SQL, since through the API they would take minutes, in batches of 5,000, each short enough for the
		// other tests of the combination, whose Directus waits a second for the file (V-180).
		beforeAll(async () => {
			await createCollectionOf(collection);
			await runOnSqlite(
				containerOf(),
				Array.from(
					{ length: 11 },
					(_, batch) =>
						`insert into ${collection} (region, geometry)
						with recursive n(i) as (select 0 union all select i + 1 from n where i < 4999)
						select 'south', MakePoint(${String(longitude)} + (i % 100) * 0.0001,
							${String(latitude)} + (${String(batch * 50)} + i / 100) * 0.0001, 4326)
						from n`,
				),
			);
		}, 120_000);

		it('na ordem natural, o servidor ordena só os 50.000 primeiros pela chave, e o resultado avisa no meta', async () => {
			const { data, meta } = await capped({ limit: String(limitMaximum) });
			const distances = data.map(({ $geo }) => $geo.distance ?? Number.NaN);

			expect(meta).toEqual({ capped: { limit: 50_000 }, next: expect.any(String) as unknown });
			expect(data).toHaveLength(limitMaximum);
			expect(data.every(({ id }) => Number(id) <= 50_000)).toBe(true);
			expect(distances).toEqual([...distances].sort((a, b) => a - b));
			expect(data[0]).toMatchObject({ id: 1, $geo: { distance: 0 } });
		});

		// The longest the event loop of Directus ran late since the last read, in milliseconds (test/measure/observer/).
		const lagOf = () =>
			as('admin').request(customEndpoint<number>({ path: '/geospatial-test-observer/lag', method: 'GET' }));

		// The smallest lag of three requests in a row: the block of the code shows in each one, and a busy machine, which
		// takes the processor from Directus for a while and makes the loop late too, seldom in all three.
		it('ordenar os 50.000 no servidor não atrasa o laço de eventos até o limitador de pressão do Directus (V-181)', async () => {
			const lags: number[] = [];

			for (let request = 0; request < 3; request += 1) {
				await lagOf();

				const { meta } = await capped({ limit: String(limitMaximum) });

				expect(meta).toEqual({ capped: { limit: 50_000 }, next: expect.any(String) as unknown });
				lags.push(await lagOf());
			}

			expect(Math.min(...lags)).toBeLessThan(500);
		});

		it('com o sort da página, que o banco ordena, a lista vem inteira, sem o aviso', async () => {
			const { data, meta } = await capped({ sort: '-id', limit: '3' });

			expect(meta).toEqual({ next: expect.any(String) as unknown });
			expect(data.map(({ id }) => id)).toEqual([55_000, 54_999, 54_998]);
		});

		it('num círculo menor que o limite, a ordem natural vem inteira, sem o aviso', async () => {
			const { data, meta } = await capped({ limit: String(limitMaximum) }, 100);

			expect(meta).toBeUndefined();
			expect(data.length).toBeGreaterThan(0);
			expect(data.every(({ $geo }) => ($geo.distance ?? Number.NaN) <= 100)).toBe(true);
		});
	});

	it('um campo que não é ponto volta indisponível, com o motivo, depois da cadeia, que recusa antes quem não lê', async () => {
		const collection = 'radius_roads';

		await as('admin').request(
			createCollection({
				collection,
				schema: {},
				meta: {},
				fields: [
					{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
					{ field: 'path', type: 'geometry.LineString', schema: {}, meta: {} },
				],
			}),
		);

		expect(await errorOf(radius(as('admin'), {}, collection))).toMatchObject({
			errors: [
				{
					extensions: {
						code: 'GEOSPATIAL_OPERATION_UNAVAILABLE',
						operation: 'radius',
						reason: 'It only measures points on the database in use.',
					},
				},
			],
		});
		expect(await errorOf(radius(as('public'), {}, collection))).toMatchObject({
			errors: [{ extensions: { code: 'FORBIDDEN' } }],
		});
	});
});

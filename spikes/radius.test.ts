import {
	createCollection,
	createItems,
	createPermission,
	createPolicy,
	createRole,
	createUser,
	customEndpoint,
	readItems,
	readPolicies,
	readUsers,
} from '@directus/sdk';
import geographiclib from 'geographiclib-geodesic';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { as, type Client, connect, hasCustomPermissionRules, type Occurrence, versions } from '../test/directus.ts';
import { log, newSecret } from '../test/environment.ts';
import { southZone } from '../test/seed.ts';

// What the radius route of the spike answers (spikes/extension/src/radius.ts).
interface Radius {
	ids: number[];
	items: Record<string, unknown>[];
	executed: string[];
	buildMs: number;
	adapter: string;
}

// What the admin route of the spike says of the adapters (spikes/extension/src/endpoint.ts).
interface Adapters {
	selected: string | null;
	problems: Record<string, string[]>;
}

// What the hooks of the other spike extension received on one items.query event (spikes/hook/src/calls.ts).
interface Call {
	event: string;
	collection: string;
	query: Record<string, unknown>;
	accountability: Record<string, unknown> | null;
}

// What a page sends along with the radius, as it sends to the /items.
interface Page {
	fields?: string[];
	filter?: Record<string, unknown>;
	search?: string;
}

const wgs84 = geographiclib.Geodesic.WGS84;

// A circle of 10 km in the south zone of São Paulo. Over 10 km, the sphere and the ellipsoid disagree by up to 40 m,
// so points 2 m from the edge only fall on the right side by the geodesic distance.
const center = { longitude: -46.7, latitude: -23.65 };
const meters = 10_000;

// Points every 30° around the center, 2 m inside and 2 m outside the edge. Half of them are in the south zone and half
// in the north, which Maria does not read, and the status and the category vary, for the filter and the search.
const aroundTheEdge: Omit<Occurrence, 'id'>[] = Array.from({ length: 12 }, (_, index) => index * 30).flatMap(
	(azimuth, index) =>
		[meters - 2, meters + 2].map((distance) => {
			const { lat2, lon2 } = wgs84.Direct(center.latitude, center.longitude, azimuth, distance);

			if (lat2 === undefined || lon2 === undefined) {
				throw new Error('GeographicLib did not return the point.');
			}

			return {
				region: index % 2 === 0 ? 'south' : 'north',
				category: Math.floor(index / 4) % 2 === 0 ? 'theft' : 'fire',
				status: Math.floor(index / 2) % 2 === 0 ? 'open' : 'closed',
				occurred_at: '2026-09-10T10:00:00Z',
				geometry: { type: 'Point', coordinates: [lon2, lat2] },
			};
		}),
);

// The geometry is null where a policy lets the item through without the field.
const distanceOf = ({ coordinates: [longitude, latitude] }: Occurrence['geometry']) => {
	const { s12 } = wgs84.Inverse(center.latitude, center.longitude, latitude, longitude);

	if (s12 === undefined) {
		throw new Error('GeographicLib did not return the distance.');
	}

	return s12;
};

// The adapter, when given, is the one the request forces instead of the one the running Directus passes (F01-06).
const radius = (client: Client, page: Page = {}, collection = 'occurrences', adapter?: string) =>
	client.request(
		customEndpoint<Radius>({
			path: `/geospatial-spikes/radius/${collection}`,
			method: 'GET',
			params: { ...center, meters, ...page, ...(adapter && { adapter }) },
		}),
	);

// The /items of a collection by its path, which also reaches the collections the schema of the suite does not know.
const itemsOf = <Item>(client: Client, collection: string, params: Record<string, unknown>) =>
	client.request(customEndpoint<Item[]>({ path: `/items/${collection}`, method: 'GET', params }));

// What the /items of a user returns inside the circle, with the same filter and search, by the distance of
// GeographicLib.
const expectedFor = async (client: Client, { filter, search }: Page = {}, collection = 'occurrences') => {
	const items = await itemsOf<{ id: number; geometry: Occurrence['geometry'] | null }>(client, collection, {
		fields: ['id', 'geometry'],
		limit: -1,
		...(filter && { filter }),
		...(search && { search }),
	});

	return items
		.filter(({ geometry }) => geometry !== null && distanceOf(geometry) <= meters)
		.map(({ id }) => id)
		.sort((a, b) => a - b);
};

// The error a request fails with, to compare the one of the radius with the one of the /items.
const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error instanceof Object && 'errors' in error ? error.errors : error;
	}

	throw new Error('The request did not fail.');
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

const percentile95 = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.NaN;

// A user of a new role whose policies each read the occurrences of one filter, with some fields, and a client that
// calls Directus as that user.
const userWith = async (name: string, policies: { filter: Record<string, unknown>; fields: string[] }[]) => {
	const admin = as('admin');
	const role = await admin.request(createRole({ name }));

	for (const [index, { filter, fields }] of policies.entries()) {
		await admin.request(
			createPolicy({
				name: `${name} ${String(index + 1)}`,
				admin_access: false,
				app_access: false,
				permissions: [{ collection: 'occurrences', action: 'read', fields, permissions: filter }],
				roles: [{ role: role.id }],
			}),
		);
	}

	const token = newSecret();
	const directus = inject('directus')[inject('combination')];

	if (directus === undefined) {
		throw new Error('The global setup did not start this combination.');
	}

	await admin.request(
		createUser({
			email: `${name.toLowerCase().replaceAll(' ', '-')}@example.com`,
			password: newSecret(),
			role: role.id,
			token,
		}),
	);

	return connect(directus.url, token);
};

// What the hooks of the other spike extension received since the last time they were asked.
const takeCalls = () =>
	as('admin').request(customEndpoint<Call[]>({ path: '/geospatial-spikes-hook/calls', method: 'GET' }));

// The queries that reached the database of the spike since the last time they were asked.
const takeQueries = () =>
	as('admin').request(customEndpoint<string[]>({ path: '/geospatial-spikes/queries', method: 'GET' }));

const south = { region: { _eq: 'south' } };
const north = { region: { _eq: 'north' } };
const everyFieldBut = (field: string) =>
	['id', 'geometry', 'region', 'category', 'status', 'occurred_at'].filter((name) => name !== field);

// The envelope of this spike is the one of PostGIS. SQLite has its own, in F01-07. The files of a project run in
// parallel, so the tests that read these points stay in this file, one after the other.
describe.runIf(versions().database.client === 'postgres')('o raio sobre a query permitida, no PostGIS', () => {
	beforeAll(async () => {
		await as('admin').request(createItems('occurrences', aroundTheEdge));
	});

	describe('a Maria, num SQL só (F01-02)', () => {
		it.runIf(hasCustomPermissionRules())(
			'o raio da Maria devolve os mesmos ids do gabarito da GeographicLib, sem os da zona norte',
			async () => {
				const expected = await expectedFor(as('maria'));
				const everyone = await expectedFor(as('admin'));

				expect((await radius(as('maria'))).ids).toEqual(expected);
				// The circle holds items Maria cannot read, and items on both sides of the edge.
				expect(everyone.length).toBeGreaterThan(expected.length);
				expect(expected.length).toBeGreaterThan(0);
			},
		);

		it.runIf(hasCustomPermissionRules())(
			'a query permitida não roda sozinha: só o envelope lê as ocorrências, num SQL só',
			async () => {
				const { executed } = await radius(as('maria'));

				expect(executed).toHaveLength(1);
				expect(executed[0]).toMatch(/ST_DWithin/);
				log(`${inject('combination')}: the envelope of Maria reached the database as ${executed[0] ?? ''}`);
			},
		);

		it.runIf(hasCustomPermissionRules())(
			'montar a query permitida da Maria, em 50 pedidos seguidos, com o mesmo resultado',
			async () => {
				const results = [];

				for (let request = 0; request < 50; request++) {
					results.push(await radius(as('maria')));
				}

				const [first] = results;

				expect(results.every(({ ids }) => JSON.stringify(ids) === JSON.stringify(first?.ids))).toBe(true);

				const times = results.map(({ buildMs }) => buildMs);

				log(
					`${inject('combination')}: building the permitted query of Maria took ${median(times).toFixed(2)} ms (median) and ${percentile95(times).toFixed(2)} ms (p95) over ${String(times.length)} requests`,
				);
			},
		);
	});

	describe('os outros papéis e o que a página manda (F01-03)', () => {
		it('o raio do admin devolve todas as ocorrências dentro do raio, sem filtro de permissão', async () => {
			expect((await radius(as('admin'))).ids).toEqual(await expectedFor(as('admin')));
		});

		it('o público recebe do raio o mesmo erro do /items', async () => {
			const items = await errorOf(as('public').request(readItems('occurrences')));

			expect(await errorOf(radius(as('public')))).toEqual(items);
			expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
		});

		it.runIf(hasCustomPermissionRules())(
			'com o filtro e a busca da página, o raio da Maria bate com o /items dela com os mesmos',
			async () => {
				const page = { filter: { status: { _eq: 'open' } }, search: 'theft' };
				const expected = await expectedFor(as('maria'), page);

				expect((await radius(as('maria'), page)).ids).toEqual(expected);
				// The filter and the search leave out items the radius alone would bring.
				expect(expected.length).toBeGreaterThan(0);
				expect(expected.length).toBeLessThan((await expectedFor(as('maria'))).length);
			},
		);

		it.runIf(hasCustomPermissionRules())(
			'o raio do papel com duas políticas devolve a união das duas (V-22)',
			async () => {
				const expected = await expectedFor(as('twoPolicies'));
				const items = await as('admin').request(
					readItems('occurrences', { filter: { id: { _in: expected } }, limit: -1 }),
				);

				expect((await radius(as('twoPolicies'))).ids).toEqual(expected);
				// Items that only one of the policies allows: north and not theft, and theft and not north.
				expect(items.some(({ region, category }) => region === 'north' && category !== 'theft')).toBe(true);
				expect(items.some(({ region, category }) => region !== 'north' && category === 'theft')).toBe(true);
			},
		);

		describe.runIf(hasCustomPermissionRules())('com campos sem permissão', () => {
			let withoutCategory: Client;
			let withoutGeometry: Client;
			let geometryInPart: Client;

			beforeAll(async () => {
				withoutCategory = await userWith('Without category', [{ filter: south, fields: everyFieldBut('category') }]);
				withoutGeometry = await userWith('Without geometry', [{ filter: south, fields: everyFieldBut('geometry') }]);
				geometryInPart = await userWith('Geometry in part', [
					{ filter: south, fields: ['*'] },
					{ filter: north, fields: everyFieldBut('geometry') },
				]);
			});

			it('com fields=*, o campo sem permissão fica de fora, como no /items', async () => {
				const [item] = await withoutCategory.request(readItems('occurrences', { fields: ['*'], limit: 1 }));
				const { items } = await radius(withoutCategory, { fields: ['*'] });

				expect(items.length).toBeGreaterThan(0);
				expect(items.every((row) => !('category' in row))).toBe(true);
				expect(Object.keys(items[0] ?? {}).sort()).toEqual(Object.keys(item ?? {}).sort());
			});

			it('pedido pelo nome, o campo sem permissão dá o mesmo erro do /items', async () => {
				const items = await errorOf(withoutCategory.request(readItems('occurrences', { fields: ['category'] })));

				expect(await errorOf(radius(withoutCategory, { fields: ['category'] }))).toEqual(items);
				expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			});

			it('sem permissão na geometria, o raio dá o erro de permissão do /items, e não um raio vazio', async () => {
				const items = await errorOf(withoutGeometry.request(readItems('occurrences', { fields: ['*', 'geometry'] })));

				expect(await errorOf(radius(withoutGeometry))).toEqual(items);
				expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
			});

			it('o item que uma política deixa ver sem a geometria fica fora do raio, sem vazar onde ele está', async () => {
				// The geometry comes null where the policy of the north lets the item through without it.
				const visible: { id: number; region: string; geometry: Occurrence['geometry'] | null }[] =
					await geometryInPart.request(readItems('occurrences', { fields: ['id', 'region', 'geometry'], limit: -1 }));
				const expected = await expectedFor(geometryInPart);

				const hidden = visible.filter(({ geometry }) => geometry === null).map(({ id }) => id);
				const inside = await expectedFor(as('admin'));

				// The /items shows items of the north without their geometry, and some of them are inside the circle: a radius
				// over the column itself would give their place away.
				expect(visible.some(({ region, geometry }) => region === 'north' && geometry === null)).toBe(true);
				expect(hidden.some((id) => inside.includes(id))).toBe(true);
				expect((await radius(geometryInPart)).ids).toEqual(expected);
				expect(expected.length).toBeGreaterThan(0);
			});
		});
	});

	// The hook of spikes/hook leaves the query of this collection with the open occurrences. It holds the points around
	// the edge, and Maria reads it by the same rule as the occurrences.
	describe.runIf(hasCustomPermissionRules())('o hook items.query de outra extensão (F01-04)', () => {
		const hooked = 'hooked_occurrences';

		beforeAll(async () => {
			const admin = as('admin');

			await admin.request(
				createCollection({
					collection: hooked,
					schema: {},
					meta: {},
					fields: [
						{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
						{ field: 'geometry', type: 'geometry.Point', schema: {} },
						{ field: 'region', type: 'string', schema: {} },
						{ field: 'category', type: 'string', schema: {} },
						{ field: 'status', type: 'string', schema: {} },
						{ field: 'occurred_at', type: 'timestamp', schema: {} },
					],
				}),
			);

			await admin.request(
				customEndpoint({ path: `/items/${hooked}`, method: 'POST', body: JSON.stringify(aroundTheEdge) }),
			);

			const [policy] = await admin.request(readPolicies({ fields: ['id'], filter: { name: { _eq: 'South zone' } } }));

			if (policy === undefined) {
				throw new Error('The seed did not create the policy of Maria.');
			}

			await admin.request(
				createPermission({
					policy: policy.id,
					collection: hooked,
					action: 'read',
					fields: ['*'],
					permissions: southZone,
				}),
			);
		});

		it('o raio da Maria bate com o /items dela, que já passa pelo hook', async () => {
			const expected = await expectedFor(as('maria'), {}, hooked);
			const permitted = aroundTheEdge.filter(
				({ region, geometry }) => region === 'south' && distanceOf(geometry) <= meters,
			);
			const open = permitted.filter(({ status }) => status === 'open');

			expect((await radius(as('maria'), {}, hooked)).ids).toEqual(expected);
			// The /items leaves out the closed occurrences the permission alone lets through.
			expect(expected).toHaveLength(open.length);
			expect(open.length).toBeGreaterThan(0);
			expect(open.length).toBeLessThan(permitted.length);
		});

		it('o hook recebe do raio a mesma query e o mesmo contexto que recebe do /items', async () => {
			const page = { fields: ['*'], filter: { category: { _eq: 'theft' } }, search: 'open' };
			const [maria] = await as('admin').request(
				readUsers({ fields: ['id', 'role'], filter: { email: { _eq: 'maria@example.com' } } }),
			);

			await takeCalls();
			await itemsOf(as('maria'), hooked, page);
			const items = await takeCalls();

			await radius(as('maria'), page, hooked);

			expect(await takeCalls()).toEqual(items);
			expect(items).toMatchObject([
				{
					event: 'items.query',
					collection: hooked,
					query: page,
					accountability: { user: maria?.id, role: maria?.role },
				},
				{ event: `${hooked}.items.query`, collection: hooked, query: page },
			]);
		});

		it('o hook age só na coleção dele: o raio das ocorrências passa por ele e sai como antes', async () => {
			await takeCalls();
			const { ids } = await radius(as('maria'));
			const calls = await takeCalls();

			expect(calls).toMatchObject([{ event: 'items.query', collection: 'occurrences' }]);
			expect(ids).toEqual(await expectedFor(as('maria')));
		});
	});

	// Each adapter expects what the internals of its Directus have, and the radius refuses one the running Directus does
	// not pass, before it builds any query (§5, protections 1 and 2).
	describe('o adaptador por versão e a checagem dos internos (F01-06)', () => {
		const running = versions().directus.startsWith('11.') ? '11.17' : '12';
		const other = running === '12' ? '11.17' : '12';

		it('a checagem escolhe o adaptador da versão em execução, e recusa o da outra e o quebrado', async () => {
			const { selected, problems } = await as('admin').request(
				customEndpoint<Adapters>({ path: '/geospatial-spikes/adapters', method: 'GET' }),
			);

			log(`${inject('combination')}: the adapters found ${JSON.stringify(problems)}`);
			expect(selected).toBe(running);
			expect(problems[running]).toEqual([]);
			expect(problems[other]).toEqual([
				expect.stringContaining('@directus/api/permissions/modules/assert-collection-active/assert-collection-active'),
			]);
			expect(problems.broken).toEqual([
				expect.stringContaining('getDBQuery declares 2 parameters, and the adapter expects 3'),
				expect.stringContaining('has no function getPermittedQuery'),
			]);
		});

		it.each([other, 'broken'])(
			'o raio com o adaptador %s forçado responde com erro, e nenhuma query chega às ocorrências',
			async (adapter) => {
				await takeQueries();

				const error = await errorOf(radius(as('admin'), {}, 'occurrences', adapter));
				const queries = await takeQueries();

				expect(error).toMatchObject([{ extensions: { code: 'GEOSPATIAL_INTERNALS_UNSUPPORTED' } }]);
				expect(queries.filter((sql) => sql.includes('"occurrences"'))).toEqual([]);
			},
		);

		it('com o adaptador da versão, forçado ou escolhido, o raio chega ao banco, e o log das queries o vê', async () => {
			await takeQueries();

			const forced = await radius(as('admin'), {}, 'occurrences', running);
			const chosen = await radius(as('admin'));
			const queries = await takeQueries();

			expect([forced.adapter, chosen.adapter]).toEqual([running, running]);
			expect(forced.ids).toEqual(chosen.ids);
			expect(queries.filter((sql) => sql.includes('"occurrences"') && sql.includes('ST_DWithin'))).toHaveLength(2);
		});
	});
});

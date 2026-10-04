import { createCollection, customEndpoint } from '@directus/sdk';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { as, databaseContainer, fetchAs, hasCustomPermissionRules, type Role } from './directus.ts';
import { callsOn, queryOn } from './postgres.ts';
import { circle, wgs84 } from './seed.ts';
import { type Item, type ItemsResponse, limitMaximum } from 'directus-geospatial-contract';

const postgis = combinations[inject('combination')].database.client === 'postgres';

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

type Asker = Exclude<Role, 'public'>;

// Maria, where Directus takes the rule of her policy, or else the admin (V-114).
const user = (): Asker => (hasCustomPermissionRules() ? 'maria' : 'admin');

// A page of the radius in the format of /items, with the whole body, the meta included, which the client of the SDK
// leaves out. Each response goes through the contract (test/contract.ts).
const pageOf = async (role: Asker, params: Record<string, string>, collection = 'occurrences') => {
	const query = new URLSearchParams({ geo: JSON.stringify(geo), ...params });
	const response = await fetchAs(role, `/geospatial/items/${collection}?${query.toString()}`);
	const body = (await response.json()) as ItemsResponse & { errors?: unknown };

	if (!response.ok) {
		throw Object.assign(new Error(`The radius failed with ${String(response.status)}.`), body);
	}

	return body;
};

// Every page of a list, one after the other, by the cursor each page brings, until the last one, which brings none.
const byCursor = async (read: (cursor: string | undefined) => Promise<ItemsResponse>) => {
	const items: Item[] = [];
	let cursor: string | undefined;

	for (let turn = 0; turn < 100; turn += 1) {
		const { data, meta } = await read(cursor);

		items.push(...data);

		if (meta?.next === undefined) {
			return items;
		}

		cursor = meta.next;
	}

	throw new Error('The list did not end in 100 pages.');
};

const idsOf = (items: Item[]) => items.map(({ id }) => Number(id));

// The point at a distance north of the center.
const at = (meters: number) => {
	const [longitude, latitude] = circle.center;
	const { lon2, lat2 } = wgs84.Direct(latitude, longitude, 0, meters);

	return { type: 'Point', coordinates: [lon2, lat2] };
};

// A collection only one test reads, as Directus creates it, with items at the distances given, by the path of /items,
// since the schema of the suite does not know it.
const collectionWith = async (collection: string, meters: number[]) => {
	const admin = as('admin');

	await admin.request(
		createCollection({
			collection,
			schema: {},
			meta: {},
			fields: [
				{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
				{ field: 'geometry', type: 'geometry.Point', schema: {}, meta: {} },
				{ field: 'stamped_at', type: 'timestamp', schema: {}, meta: {} },
			],
		}),
	);
	await admin.request(
		customEndpoint({
			path: `/items/${collection}`,
			method: 'POST',
			body: JSON.stringify(meters.map((distance) => ({ geometry: at(distance) }))),
		}),
	);
};

const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error;
	}

	throw new Error('The request did not fail.');
};

describe('o cursor do raio (D-054)', () => {
	it('percorrer o raio inteiro da Maria por cursor dá cada item uma vez, na ordem natural', async () => {
		const whole = await pageOf(user(), { fields: 'id', limit: String(limitMaximum) });
		const items = await byCursor((cursor) => pageOf(user(), { fields: 'id', limit: '2', ...(cursor && { cursor }) }));

		expect(idsOf(items)).toEqual(idsOf(whole.data));
		expect(items.map(({ $geo }) => $geo)).toEqual(whole.data.map(({ $geo }) => $geo));
		expect(new Set(idsOf(items)).size).toBe(items.length);
		expect(items.length).toBeGreaterThan(2);
	});

	it('com as distâncias empatadas, cada item vem uma vez, pela chave', async () => {
		const collection = 'cursor_ties';

		// Three places, with their items interleaved by the key, and the page smaller than each tie.
		await collectionWith(collection, [500, 1_000, 500, 2_000, 1_000, 500, 2_000, 1_000, 500]);

		const items = await byCursor((cursor) =>
			pageOf('admin', { fields: 'id', limit: '2', ...(cursor && { cursor }) }, collection),
		);

		expect(idsOf(items)).toEqual([1, 3, 6, 9, 2, 5, 8, 4, 7]);
	});

	it.runIf(hasCustomPermissionRules()).each(['status', '-status'])(
		'com sort=%s e o campo vazio onde a política o esconde, o cursor segue a ordem do banco, com o vazio no lugar dele',
		async (sort) => {
			const params = { fields: 'id,status', sort };
			const whole = await pageOf('statusInPart', { ...params, limit: String(limitMaximum) });
			const items = await byCursor((cursor) =>
				pageOf('statusInPart', { ...params, limit: '2', ...(cursor && { cursor }) }),
			);

			expect(items).toEqual(whole.data);
			expect(whole.data.some(({ status }) => status === null)).toBe(true);
			expect(whole.data.some(({ status }) => status !== null)).toBe(true);
		},
	);

	it.runIf(postgis)(
		'com sort por um timestamp com microssegundos, que uma data do JavaScript perderia, cada item vem uma vez',
		async () => {
			const collection = 'cursor_stamps';

			await collectionWith(collection, [100, 200, 300]);
			// Microseconds apart, which only the database keeps.
			await queryOn(
				databaseContainer(),
				`update ${collection} set stamped_at = timestamptz '2026-09-01 10:00:00.123456+00' + id * interval '1 microsecond'`,
			);

			const items = await byCursor((cursor) =>
				pageOf('admin', { fields: 'id', sort: 'stamped_at', limit: '1', ...(cursor && { cursor }) }, collection),
			);

			expect(idsOf(items)).toEqual([1, 2, 3]);
		},
	);

	it('um item gravado no meio da leitura não faz a lista pular nem repetir o que já veio, como o offset faz', async () => {
		const collection = 'cursor_writes';

		await collectionWith(collection, [100, 200, 300, 400, 500, 600]);

		const page = (params: Record<string, string>) =>
			pageOf('admin', { fields: 'id', limit: '2', ...params }, collection);
		const first = await page({});

		// One item before the place the reading reached, and one after it.
		await as('admin').request(
			customEndpoint({
				path: `/items/${collection}`,
				method: 'POST',
				body: JSON.stringify([{ geometry: at(50) }, { geometry: at(350) }]),
			}),
		);

		const rest = await byCursor((cursor) => page({ cursor: cursor ?? String(first.meta?.next) }));
		const byOffset = await page({ offset: '2' });

		// The item at 50 m came before the cursor, and the item at 350 m comes in its place.
		expect(idsOf([...first.data, ...rest])).toEqual([1, 2, 3, 8, 4, 5, 6]);
		// By the offset, the item at 50 m pushes the item at 200 m, already read, into the next page.
		expect(idsOf(byOffset.data)).toEqual([2, 3]);
	});

	it('um cursor adulterado ou de outra lista volta com o erro de entrada, e um cursor com o offset, com o INVALID_QUERY', async () => {
		const { meta } = await pageOf(user(), { fields: 'id', limit: '1' });
		const cursor = String(meta?.next);
		const changed = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}`;

		expect(await errorOf(pageOf(user(), { fields: 'id', cursor: changed }))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_INVALID_INPUT', reason: 'The cursor is not one this list gave' } }],
		});
		expect(await errorOf(pageOf(user(), { fields: 'id', sort: '-id', cursor }))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_INVALID_INPUT' } }],
		});
		expect(await errorOf(pageOf(user(), { fields: 'id', offset: '1', cursor }))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY' } }],
		});
	});

	describe.runIf(postgis)('sem tocar o banco', () => {
		const collection = 'cursor_untouched';

		beforeAll(() => collectionWith(collection, [100, 200, 300]));

		it('um cursor adulterado volta com o erro de entrada, sem nenhuma query na coleção', async () => {
			const { meta } = await pageOf('admin', { fields: 'id', limit: '1' }, collection);
			const cursor = String(meta?.next);
			const before = await callsOn(databaseContainer(), `"${collection}"`);
			const error = await errorOf(
				pageOf(
					'admin',
					{ fields: 'id', cursor: `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}` },
					collection,
				),
			);

			expect(error).toMatchObject({ errors: [{ extensions: { code: 'GEOSPATIAL_INVALID_INPUT' } }] });
			expect(await callsOn(databaseContainer(), `"${collection}"`)).toBe(before);
		});
	});

	it('o SEARCH leva o cursor no corpo, e a consulta registrada, na URL, e as duas percorrem a mesma lista', async () => {
		const whole = await pageOf(user(), { fields: 'id', limit: String(limitMaximum) });
		const searched = await byCursor(async (cursor) => {
			const response = await fetchAs(user(), '/geospatial/items/occurrences', {
				method: 'SEARCH',
				body: JSON.stringify({ geo, query: { fields: ['id'], limit: 2 }, ...(cursor && { cursor }) }),
			});

			return (await response.json()) as ItemsResponse;
		});
		const { id } = await as(user()).request(
			customEndpoint<{ id: string }>({
				path: '/geospatial/queries',
				method: 'POST',
				body: JSON.stringify({ collection: 'occurrences', geo, query: { fields: ['id'] } }),
			}),
		);
		const registered = await byCursor(async (cursor) => {
			const query = new URLSearchParams({ limit: '2', ...(cursor && { cursor }) });
			const response = await fetchAs(user(), `/geospatial/queries/${id}/items?${query.toString()}`);

			return (await response.json()) as ItemsResponse;
		});

		expect(idsOf(searched)).toEqual(idsOf(whole.data));
		expect(idsOf(registered)).toEqual(idsOf(whole.data));
	});
});

import { createItems, createPermission, customEndpoint, readItems, readPolicies } from '@directus/sdk';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { as, type Client, hasCustomPermissionRules, type Occurrence, type Role } from './directus.ts';
import { circle, createOccurrences, occurrences, southZone, wgs84 } from './seed.ts';
import type { Item } from 'directus-geospatial-contract';

const postgis = combinations[inject('combination')].database.client === 'postgres';

// The collection of the other extension of the suite (test/hook/), whose hook on the event of the collection leaves
// only the open occurrences, and whose hook on every items.query records what it gets on this collection.
const hooked = 'hooked_occurrences';

// What a hook of the other extension received on one items.query event (test/hook/src/calls.ts).
interface Call {
	event: string;
	collection: string;
	query: Record<string, unknown>;
	accountability: Record<string, unknown> | null;
}

// What the hooks received since the last take, as the other extension hands it to the admin.
const takeCalls = () =>
	as('admin').request(customEndpoint<Call[]>({ path: '/geospatial-test-hook/calls', method: 'GET' }));

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// The radius in the format of /items. Each response goes through the contract (test/contract.ts).
const radius = (client: Client, collection: string, params: Record<string, unknown> = {}) =>
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

// What /items gives a user inside the circle, by the distance of GeographicLib, with the hooks of items.query that
// /items runs too.
const expectedFor = async (client: Client, collection: 'occurrences' | 'hooked_occurrences') => {
	const items = await client.request(
		readItems(collection, { fields: ['id', 'status', 'geometry'], limit: -1, sort: ['id'] }),
	);

	return items
		.filter(({ geometry }) => distanceOf(geometry) <= circle.meters)
		.map(({ id, status }) => ({ id, status }));
};

beforeAll(async () => {
	const admin = as('admin');

	await createOccurrences(admin, hooked);
	await admin.request(createItems(hooked, occurrences));

	// Maria reads the south zone of the collection of the other extension too.
	if (hasCustomPermissionRules()) {
		const [policy] = await admin.request(readPolicies({ filter: { name: { _eq: 'South zone' } }, fields: ['id'] }));

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
	}

	// The reads of the setup, which the tests do not compare.
	await takeCalls();
}, 60_000);

describe('o hook items.query de outra extensão', () => {
	it('sobe ao lado da extensão e muda o /items da coleção dele, que só traz as ocorrências abertas', async () => {
		const items = await as('admin').request(readItems(hooked, { fields: ['status'], limit: -1 }));

		expect(items.length).toBeGreaterThan(0);
		expect(items.every(({ status }) => status === 'open')).toBe(true);
	});

	it.skipIf(postgis)(
		'onde o raio não roda, ele responde antes de emitir o items.query, e nenhum hook roda',
		async () => {
			await takeCalls();

			await expect(radius(as('admin'), hooked)).rejects.toMatchObject({
				errors: [{ extensions: { code: 'GEOSPATIAL_OPERATION_UNAVAILABLE' } }],
			});
			expect(await takeCalls()).toEqual([]);
		},
	);
});

describe.runIf(postgis).each([
	['da Maria', 'maria', hasCustomPermissionRules()],
	['do admin', 'admin', true],
] as const)('o raio %s com o hook items.query de outra extensão (V-144)', (_, role: Role, runs) => {
	it.runIf(runs)('bate com o /items, que o hook também muda', async () => {
		const expected = await expectedFor(as(role), hooked);

		expect(await radius(as(role), hooked, { fields: 'id,status', limit: -1 })).toEqual(expected);
		expect(expected.length).toBeGreaterThan(0);
		expect(expected.every(({ status }) => status === 'open')).toBe(true);
	});

	it.runIf(runs)(
		'o hook recebe dele a mesma query, os mesmos eventos, a mesma coleção e a mesma accountability que do /items',
		async () => {
			const page = { fields: 'id,region', filter: { category: { _eq: 'theft' } } };

			await takeCalls();
			await as(role).request(customEndpoint({ path: `/items/${hooked}`, method: 'GET', params: page }));

			const fromItems = await takeCalls();

			await radius(as(role), hooked, page);

			expect(await takeCalls()).toEqual(fromItems);
			expect(fromItems.map(({ event }) => event)).toEqual(['items.query', `${hooked}.items.query`]);
			expect(fromItems[0]).toMatchObject({
				collection: hooked,
				query: { fields: ['id', 'region'], filter: { category: { _eq: 'theft' } } },
				accountability: { admin: role === 'admin' },
			});
		},
	);
});

describe.runIf(postgis)('um hook no evento de outra coleção', () => {
	it('não muda o raio das ocorrências', async () => {
		const expected = await expectedFor(as('admin'), 'occurrences');

		expect(await radius(as('admin'), 'occurrences', { fields: 'id,status', limit: -1 })).toEqual(expected);
		expect(expected.some(({ status }) => status === 'closed')).toBe(true);
	});
});

import { createCollection, customEndpoint } from '@directus/sdk';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { type Client, connect } from './directus.ts';
import { type Environment, environmentTimeout, extension, observer, startEnvironment } from './environment.ts';
import { circle, createOccurrences } from './seed.ts';
import type { Capabilities } from 'directus-geospatial-contract';

const combination = inject('combination');
const {
	database: { client },
	nightly,
} = combinations[combination];

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// The reason the capabilities give, which the radius gives too.
const reason = 'The database in use has no spatial extension.';

// Each part of the radius, in the format of /items and by a registered query (D-004), from its own request.
const parts: [string, (admin: Client, id: string) => Promise<unknown>][] = [
	[
		'a lista no estilo do /items',
		(admin) => admin.request(customEndpoint({ path: '/geospatial/items/occurrences', method: 'GET', params: { geo } })),
	],
	[
		'a lista no estilo do /items, pelo SEARCH',
		(admin) =>
			admin.request(
				customEndpoint({ path: '/geospatial/items/occurrences', method: 'SEARCH', body: JSON.stringify({ geo }) }),
			),
	],
	[
		'os itens da consulta registrada',
		(admin, id) => admin.request(customEndpoint({ path: `/geospatial/queries/${id}/items`, method: 'GET' })),
	],
	[
		'as formas da consulta registrada',
		(admin, id) => admin.request(customEndpoint({ path: `/geospatial/queries/${id}/shapes`, method: 'GET' })),
	],
	[
		'o resumo da consulta registrada',
		(admin, id) => admin.request(customEndpoint({ path: `/geospatial/queries/${id}/summary`, method: 'GET' })),
	],
];

// A Directus of its own, so the other tests of the combination keep the spatial extension. Once with each Directus
// version: on SQLite, its official image, which has no SpatiaLite (V-104), and on PostGIS, a Postgres without the
// extension in the database of Directus. The one on PostGIS only runs in the combinations of the night, since the four
// of a pull request on one machine already start Directus past the pressure limiter of Directus (A-052).
describe.runIf(client === 'sqlite' || nightly)('um banco sem a extensão espacial (A-050)', () => {
	let environment: Environment | undefined;

	const admin = () => {
		if (environment === undefined) {
			throw new Error('The Directus of the test did not start.');
		}

		return connect(environment.url, environment.admin.token);
	};

	// How many statements reached the collection, as the observer of the suite counts them in any database.
	const callsOnOccurrences = () =>
		admin().request(
			customEndpoint<number>({
				path: '/geospatial-test-observer/calls',
				method: 'GET',
				params: { piece: '"occurrences"' },
			}),
		);

	beforeAll(async () => {
		environment = await startEnvironment(combination, inject('coverage'), {
			name: `${combination}-without-spatial`,
			packages: [extension, observer],
			spatial: false,
			slots: inject('slots'),
		});

		// SQLite takes a column of any type by its name, so Directus creates the geometry field without SpatiaLite, and only
		// fails to write a geometry. A Postgres without PostGIS has no type for it, so the collection goes without (V-199).
		if (client === 'sqlite') {
			await createOccurrences(admin(), 'occurrences');
		} else {
			await admin().request(
				createCollection({
					collection: 'occurrences',
					schema: {},
					meta: {},
					fields: [
						{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
						{ field: 'region', type: 'string', schema: {} },
					],
				}),
			);
		}
	}, environmentTimeout);

	afterAll(() => environment?.stop(), 120_000);

	it('o capabilities do admin mostra o banco sem a extensão espacial, e o raio indisponível, com o motivo', async () => {
		const capabilities = await admin().request(
			customEndpoint<Capabilities>({ path: '/geospatial/capabilities', method: 'GET' }),
		);

		expect(capabilities).toMatchObject({
			database: { client },
			spatial: null,
			operations: { radius: { level: 'unavailable', reason } },
			internals: { status: 'accepted' },
		});
	});

	it.each(parts)('%s responde que o raio é indisponível, com o mesmo motivo, sem query na coleção', async (_, part) => {
		const { id } = await admin().request(
			customEndpoint<{ id: string }>({
				path: '/geospatial/queries',
				method: 'POST',
				body: JSON.stringify({ collection: 'occurrences', geo }),
			}),
		);
		const before = await callsOnOccurrences();

		await expect(part(admin(), id)).rejects.toMatchObject({
			response: { status: 501 },
			errors: [
				{
					message: `The operation radius is unavailable. ${reason}`,
					extensions: { code: 'GEOSPATIAL_OPERATION_UNAVAILABLE', operation: 'radius', reason },
				},
			],
		});
		expect(await callsOnOccurrences()).toBe(before);
	});
});

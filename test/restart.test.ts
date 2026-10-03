import { createItems, customEndpoint } from '@directus/sdk';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type Client, connect } from './directus.ts';
import { type Environment, startEnvironment } from './environment.ts';
import { circle, createOccurrences, occurrences } from './seed.ts';
import type { Item } from 'directus-geospatial-contract';

const combination = inject('combination');

const question = {
	collection: 'occurrences',
	geo: { operation: 'radius', center: circle.center, distance: circle.meters },
	query: { fields: ['id', 'region'] },
};

const registered = async (client: Client) =>
	(
		await client.request(
			customEndpoint<{ id: string }>({ path: '/geospatial/queries', method: 'POST', body: JSON.stringify(question) }),
		)
	).id;

const itemsOf = (client: Client, id: string) =>
	client.request(customEndpoint<Item[]>({ path: `/geospatial/queries/${id}/items`, method: 'GET' }));

// The registry of the queries lives in the memory of Directus (§7.8), and the test restarts it. It starts its own, so
// the other tests of the combination keep theirs.
describe('a consulta registrada depois de reiniciar o Directus (§7.8)', () => {
	let environment: Environment | undefined;
	let url = '';

	const admin = () => {
		if (environment === undefined) {
			throw new Error('The Directus of the test did not start.');
		}

		return connect(url, environment.admin.token);
	};

	beforeAll(async () => {
		environment = await startEnvironment(combination, inject('coverage'), { name: `${combination}-restart` });
		url = environment.url;
		await createOccurrences(admin(), 'occurrences');
		await admin().request(createItems('occurrences', occurrences));
	}, 240_000);

	afterAll(() => environment?.stop(), 120_000);

	it(
		'o id de antes do reinício responde com o código de consulta desconhecida, e registrar de novo dá o mesmo id',
		{ timeout: 180_000 },
		async () => {
			const id = await registered(admin());
			const before = await itemsOf(admin(), id);

			expect(before.length).toBeGreaterThan(0);

			url = (await environment?.restart()) ?? '';

			await expect(itemsOf(admin(), id)).rejects.toMatchObject({
				errors: [{ extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }],
			});
			// The key of the ids comes from the SECRET of Directus, which the restart keeps (D-053).
			expect(await registered(admin())).toBe(id);
			expect(await itemsOf(admin(), id)).toEqual(before);
		},
	);
});

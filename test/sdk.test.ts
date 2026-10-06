import { describe, expect, it } from 'vitest';
import { as, fetchAs, hasCustomPermissionRules } from './directus.ts';
import { circle } from './seed.ts';
import { type Capabilities, type Items, wholeBodyType } from 'directus-geospatial-contract';
import { geoCapabilities, geoRadius, isGeospatialError } from 'directus-geospatial-sdk';

// The radius of the seed, in the URL of the route, as the SDK of Directus writes the geo (V-171).
const radiusPath = (params: Record<string, string>) =>
	`/geospatial/items/occurrences?${new URLSearchParams({
		geo: JSON.stringify({ operation: 'radius', center: circle.center, distance: circle.meters }),
		...params,
	}).toString()}`;

// The body of a response of the route, which has to be a success.
const bodyOf = async <Body>(response: Promise<Response>): Promise<Body> => {
	const received = await response;

	expect(received.status).toBe(200);

	return (await received.json()) as Body;
};

// Maria reads the south zone, where Directus takes a rule of her own, and the admin everything elsewhere (D-043).
const reader = () => (hasCustomPermissionRules() ? 'maria' : 'admin');

// The SDK of the extension, as a project uses it, against the Directus of each combination: each command gives what its
// route gives, with the permissions of whoever asks (D-016, D-024).
describe('o SDK da extensão num Directus de verdade (§7.8)', () => {
	it('o geoCapabilities() dá o que o GET /geospatial/capabilities dá no data, para o admin e para quem não é', async () => {
		for (const role of ['admin', 'maria'] as const) {
			const { data } = await bodyOf<{ data: Capabilities }>(fetchAs(role, '/geospatial/capabilities'));

			expect(await as(role).request(geoCapabilities())).toEqual(data);
		}
	});

	it('sem sessão, o geoCapabilities() recebe o FORBIDDEN do Directus como erro tipado (D-042)', async () => {
		const error: unknown = await as('public')
			.request(geoCapabilities())
			.catch((thrown: unknown) => thrown);

		expect(isGeospatialError(error, 'FORBIDDEN')).toBe(true);
	});

	it('o geoRadius() dá os itens e o meta da rota, e o cursor do meta leva à página seguinte (D-058)', async () => {
		const page = { center: circle.center, distance: circle.meters, fields: ['id', 'region'], limit: 5 } as const;
		const route = await bodyOf<Items>(fetchAs(reader(), radiusPath({ fields: 'id,region', limit: '5' })));
		const first = await as(reader()).request(geoRadius('occurrences', page));

		expect(first.data).toEqual(route.data);
		expect(first.data).toHaveLength(5);
		// The cursor is sealed with a nonce of its own on each response, so two of the same page differ.
		expect(typeof first.meta?.next).toBe('string');

		const cursor = String(first.meta?.next);
		const next = await as(reader()).request(geoRadius('occurrences', { ...page, cursor }));
		const nextOfRoute = await bodyOf<Items>(fetchAs(reader(), radiusPath({ fields: 'id,region', limit: '5', cursor })));

		expect(next.data).toEqual(nextOfRoute.data);
		expect(next.data.map(({ id }) => id)).not.toContain(first.data[0]?.id);
	});

	it('um erro da extensão chega tipado, com o código da API (D-045)', async () => {
		const error: unknown = await as(reader())
			.request(geoRadius('occurrences', { center: [200, -23.65], distance: 10 }))
			.catch((thrown: unknown) => thrown);

		expect(isGeospatialError(error)).toBe(true);
		expect(isGeospatialError(error, 'GEOSPATIAL_INVALID_INPUT')).toBe(true);
	});

	it('a lista sai no tipo próprio só para quem o pede, com o mesmo corpo, e o Vary separa os dois num cache', async () => {
		const asked = await fetchAs(reader(), radiusPath({ fields: 'id', limit: '3' }), { accept: wholeBodyType });
		const plain = await fetchAs(reader(), radiusPath({ fields: 'id', limit: '3' }));

		expect(asked.headers.get('Content-Type')).toMatch(new RegExp(`^${wholeBodyType.replaceAll('+', String.raw`\+`)}`));
		expect(plain.headers.get('Content-Type')).toMatch(/^application\/json/);

		for (const response of [asked, plain]) {
			expect(response.headers.get('Vary')).toMatch(/\bAccept\b/);
		}

		expect((await bodyOf<Items>(Promise.resolve(asked))).data).toEqual(
			(await bodyOf<Items>(Promise.resolve(plain))).data,
		);
	});
});

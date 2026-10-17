import { describe, expect, it } from 'vitest';
import { as, fetchAs, hasCustomPermissionRules } from './directus.ts';
import { circle } from './seed.ts';
import {
	type Capabilities,
	type Items,
	limitMaximum,
	type Shapes,
	type Summary,
	wholeBodyType,
} from 'directus-geospatial-contract';
import {
	geoCapabilities,
	geoFinalSummary,
	geoPaginate,
	geoQueryItems,
	geoQueryShapes,
	geoQuerySummary,
	geoRadius,
	geoRegisterQuery,
	isGeospatialError,
} from 'directus-geospatial-sdk';

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

// The radius of the seed, registered by the SDK, with the fields of a list.
const registered = () =>
	as(reader()).request(
		geoRegisterQuery('occurrences', {
			geo: { operation: 'radius', center: circle.center, distance: circle.meters },
			fields: ['id', 'region'],
		}),
	);

// What a request rejects with.
const rejectionOf = (request: Promise<unknown>): Promise<unknown> =>
	request.then(
		() => undefined,
		(error: unknown) => error,
	);

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

	it('toda lista com meta sai no tipo próprio só para quem o pede, com o mesmo corpo, e o Vary separa os dois num cache', async () => {
		const { id } = await registered();
		const lists = [
			radiusPath({ fields: 'id', limit: '3' }),
			`/geospatial/queries/${id}/items?limit=3`,
			`/geospatial/queries/${id}/shapes`,
		];

		for (const path of lists) {
			const asked = await fetchAs(reader(), path, { accept: wholeBodyType });
			const plain = await fetchAs(reader(), path);

			expect(asked.headers.get('Content-Type')).toMatch(
				new RegExp(`^${wholeBodyType.replaceAll('+', String.raw`\+`)}`),
			);
			expect(plain.headers.get('Content-Type')).toMatch(/^application\/json/);

			for (const response of [asked, plain]) {
				expect(response.headers.get('Vary')).toMatch(/\bAccept\b/);
			}

			// The cursor of the meta is sealed with a nonce of its own on each response, so only the data is the same.
			expect((await bodyOf<Items>(Promise.resolve(asked))).data).toEqual(
				(await bodyOf<Items>(Promise.resolve(plain))).data,
			);
		}
	});
});

// The registered query through the SDK, against the Directus of each combination: the command of each part gives what
// its route gives, and the iterator goes through the whole list by the cursor (D-004, D-022).
describe('a consulta registrada pelo SDK (§7.8)', () => {
	it('o for await percorre o raio inteiro pelo cursor, cada item uma vez, na ordem natural e na do sort', async () => {
		const client = as(reader());
		const query = await registered();
		// The natural order, and a sort of the page, which the fields of the collection type.
		const orders: (('-region' | 'id')[] | undefined)[] = [undefined, ['-region', 'id']];

		for (const sort of orders) {
			const whole = await bodyOf<Items>(
				fetchAs(
					reader(),
					`/geospatial/queries/${query.id}/items?${new URLSearchParams({
						limit: String(limitMaximum),
						...(sort !== undefined && { sort: sort.join(',') }),
					}).toString()}`,
				),
			);
			const ids: unknown[] = [];
			let pages = 0;

			for await (const page of geoPaginate(client, geoQueryItems(query, { limit: 3, sort }))) {
				ids.push(...page.data.map(({ id }) => id));
				pages += 1;
			}

			expect(ids).toEqual(whole.data.map(({ id }) => id));
			expect(new Set(ids).size).toBe(ids.length);
			expect(pages).toBe(Math.ceil(ids.length / 3));
			expect(pages).toBeGreaterThanOrEqual(2);
		}
	});

	it('as formas e o resumo saem pelos comandos como as rotas os dão, e a espera do resumo dá o total exato', async () => {
		const client = as(reader());
		const query = await registered();
		const shapes = await bodyOf<Shapes>(fetchAs(reader(), `/geospatial/queries/${query.id}/shapes`));
		const summary = await bodyOf<Summary>(fetchAs(reader(), `/geospatial/queries/${query.id}/summary`));
		const items = await bodyOf<Items>(
			fetchAs(reader(), `/geospatial/queries/${query.id}/items?limit=${String(limitMaximum)}`),
		);

		expect(await client.request(geoQueryShapes(query))).toEqual(shapes);
		expect(await client.request(geoQuerySummary(query))).toEqual(summary.data);
		expect(await geoFinalSummary(client, query)).toEqual({ total: items.data.length, exact: true, counting: false });
	});

	it('o id que o Directus não conhece chega em cada parte, e no for await, como o erro tipado de consulta desconhecida', async () => {
		const client = as(reader());
		// An id in the format of the contract that no registration gave.
		const forgotten = 'AAAAAAAAAAAAAAAAAAAAAA';
		const rejections = [
			await rejectionOf(client.request(geoQueryItems(forgotten))),
			await rejectionOf(client.request(geoQueryShapes(forgotten))),
			await rejectionOf(client.request(geoQuerySummary(forgotten))),
			await rejectionOf(geoFinalSummary(client, forgotten)),
			await rejectionOf(
				(async () => {
					for await (const page of geoPaginate(client, geoQueryItems(forgotten))) {
						expect(page).toBeUndefined();
					}
				})(),
			),
		];

		for (const error of rejections) {
			expect(isGeospatialError(error, 'GEOSPATIAL_UNKNOWN_QUERY')).toBe(true);
		}
	});
});

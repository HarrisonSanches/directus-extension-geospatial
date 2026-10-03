import { customEndpoint, readItems } from '@directus/sdk';
import { describe, expect, it } from 'vitest';
import { as, type Client, hasCustomPermissionRules } from './directus.ts';
import { circle } from './seed.ts';
import { type Item, limitMaximum } from 'directus-geospatial-contract';

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// Registers a question, and returns its id. Each response goes through the contract (test/contract.ts).
const registered = async (client: Client, question: Record<string, unknown>) =>
	(
		await client.request(
			customEndpoint<{ id: string }>({ path: '/geospatial/queries', method: 'POST', body: JSON.stringify(question) }),
		)
	).id;

// The items of a registered query, by its id, with the page in the URL.
const itemsOf = (client: Client, id: string, params: Record<string, unknown> = {}) =>
	client.request(customEndpoint<Item[]>({ path: `/geospatial/queries/${id}/items`, method: 'GET', params }));

// The radius in the format of /items, with the same question in the URL.
const radius = (client: Client, params: Record<string, unknown>) =>
	client.request(
		customEndpoint<Item[]>({ path: '/geospatial/items/occurrences', method: 'GET', params: { geo, ...params } }),
	);

// The error a request fails with, in the format of Directus.
const errorOf = async (request: Promise<unknown>) => {
	try {
		await request;
	} catch (error) {
		return error;
	}

	throw new Error('The request did not fail.');
};

const errorsOf = async (request: Promise<unknown>) => {
	const error = await errorOf(request);

	return error instanceof Object && 'errors' in error ? error.errors : error;
};

// Maria, where Directus takes the rule of her policy, or else the admin (V-114).
const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

const fields = ['id', 'region', 'category', 'status', 'geometry'];
const filter = { status: { _eq: 'open' } };
const question = { collection: 'occurrences', geo, query: { filter, fields } };

// The question in the format of /items, with the fields joined as Directus reads them in the URL.
const inUrl = { filter, fields: fields.join(',') };

describe('a consulta registrada (D-004)', () => {
	it('o mesmo pedido, com as chaves em qualquer ordem, gera o mesmo id, e um pedido diferente gera outro', async () => {
		const id = await registered(user(), question);
		const reordered = {
			query: { fields, filter },
			geo: { distance: circle.meters, center: circle.center, operation: 'radius' },
			collection: 'occurrences',
		};

		expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(await registered(user(), reordered)).toBe(id);
		// The id is of the question, whoever registers it.
		expect(await registered(as('admin'), question)).toBe(id);
		expect(await registered(user(), { ...question, geo: { ...geo, distance: 5000 } })).not.toBe(id);
		expect(await registered(user(), { ...question, query: { fields } })).not.toBe(id);
	});

	it('os itens pelo id batem com o raio no estilo do /items, na ordem natural e com o sort e o limit da URL', async () => {
		const id = await registered(user(), question);
		const natural = await itemsOf(user(), id);

		expect(natural).toEqual(await radius(user(), inUrl));
		expect(natural.length).toBeGreaterThan(1);
		expect(await itemsOf(user(), id, { sort: '-id', limit: 3 })).toEqual(
			await radius(user(), { ...inUrl, sort: '-id', limit: 3 }),
		);
	});

	it.runIf(hasCustomPermissionRules())(
		'o id que a Maria registrou, pedido pelo papel com duas políticas, devolve o que esse papel pode ver',
		async () => {
			const id = await registered(as('maria'), question);
			const page = { sort: 'id', limit: limitMaximum };
			const ofMaria = await itemsOf(as('maria'), id, page);
			const ofTwoPolicies = await itemsOf(as('twoPolicies'), id, page);

			expect(ofTwoPolicies).toEqual(await radius(as('twoPolicies'), { ...inUrl, ...page }));
			// Maria reads the south zone, and the other role the north zone and the thefts (V-22).
			expect(ofMaria.every(({ region }) => region === 'south')).toBe(true);
			expect(ofTwoPolicies.some(({ region }) => region === 'north')).toBe(true);
			expect(ofTwoPolicies.every(({ region, category }) => region === 'north' || category === 'theft')).toBe(true);
		},
	);

	it('o público, que não lê as ocorrências, recebe pelo id o mesmo erro do /items', async () => {
		const id = await registered(user(), question);
		const items = await errorsOf(as('public').request(readItems('occurrences')));

		expect(await errorsOf(itemsOf(as('public'), id))).toEqual(items);
		expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
	});

	it('um id que o Directus não conhece volta com o código de consulta desconhecida, e um fora do contrato, com o de entrada', async () => {
		expect(await errorOf(itemsOf(user(), 'AAAAAAAAAAAAAAAAAAAAAA'))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }],
			response: { status: 404 },
		});
		expect(await errorOf(itemsOf(user(), 'not-an-id'))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_INVALID_INPUT' } }],
			response: { status: 400 },
		});
	});

	it('o $NOW do filtro vira o instante do registro, e dá o mesmo raio que o /items com o $NOW (V-182)', async () => {
		// A window that starts about midnight of 4 September 2026, in UTC, hours away from any occurrence, so the minute of
		// the registration and the instant /items reads select the same ones.
		const hours = Math.round((Date.now() - Date.UTC(2026, 8, 4)) / (60 * 60 * 1000));
		const since = { occurred_at: { _gte: `$NOW(-${String(hours)} hours)` } };
		const page = { sort: 'id', limit: limitMaximum };
		const id = await registered(user(), { ...question, query: { filter: since, fields: ['id', 'occurred_at'] } });
		const items = await itemsOf(user(), id, page);
		const occurredAt = items.map((item) => Date.parse(String(item.occurred_at)));

		expect(items).toEqual(await radius(user(), { filter: since, fields: 'id,occurred_at', ...page }));
		// The circle holds occurrences of 1 and 2 September, which the window leaves out, and of 10 September.
		expect(items.length).toBeGreaterThan(0);
		expect(occurredAt.every((instant) => instant > Date.UTC(2026, 8, 4))).toBe(true);
		expect((await radius(user(), { fields: 'id', ...page })).length).toBeGreaterThan(items.length);
	});

	it.each([
		['o filter', { filter: { status: { _eq: 'closed' } } }],
		['os fields', { fields: 'id' }],
		['o offset', { offset: 1 }],
	])('com %s na URL de uma parte, volta com o INVALID_QUERY, porque vai no registro', async (_, params) => {
		const id = await registered(user(), question);

		expect(await errorOf(itemsOf(user(), id, params))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY' } }],
		});
	});

	it.each([
		['sem a coleção', { geo }, 'GEOSPATIAL_INVALID_INPUT', 400],
		[
			'com o sort, que vai na URL de cada parte',
			{ ...question, query: { sort: ['id'] } },
			'GEOSPATIAL_INVALID_INPUT',
			400,
		],
		['acima de 256 KB', { ...question, query: { search: 'x'.repeat(270_000) } }, 'GEOSPATIAL_LIMIT_EXCEEDED', 413],
		[
			'com um valor que o Directus recusa no filtro',
			{ ...question, query: { filter: { status: { _eq: { open: true } } } } },
			'INVALID_QUERY',
			400,
		],
	])('o registro %s volta com o erro, e não ganha id', async (_, body, code, status) => {
		expect(await errorOf(registered(user(), body))).toMatchObject({
			errors: [{ extensions: { code } }],
			response: { status },
		});
	});
});

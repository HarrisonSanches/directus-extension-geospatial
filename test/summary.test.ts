import { createCollection, createPermission, customEndpoint, readItems, readPolicies } from '@directus/sdk';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { as, type Client, databaseContainer, hasCustomPermissionRules, untilKnown } from './directus.ts';
import { queryOn } from './postgres.ts';
import { circle, southZone } from './seed.ts';
import { runOnSqlite } from './sqlite.ts';
import { type Item, limitMaximum, type SummaryValues } from 'directus-geospatial-contract';

const postgis = combinations[inject('combination')].database.client === 'postgres';

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// Registers a question, and returns its id. Each response goes through the contract (test/contract.ts).
const registered = async (client: Client, asked: Record<string, unknown>) =>
	(
		await client.request(
			customEndpoint<{ id: string }>({ path: '/geospatial/queries', method: 'POST', body: JSON.stringify(asked) }),
		)
	).id;

const summaryOf = (client: Client, id: string, params: Record<string, unknown> = {}) =>
	client.request(customEndpoint<SummaryValues>({ path: `/geospatial/queries/${id}/summary`, method: 'GET', params }));

// The summary once the exact count running in the background brought the total.
const exactSummaryOf = async (client: Client, id: string) => {
	await expect.poll(async () => (await summaryOf(client, id)).exact, { timeout: 30_000, interval: 200 }).toBe(true);

	return summaryOf(client, id);
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

const errorsOf = async (request: Promise<unknown>) => {
	const error = await errorOf(request);

	return error instanceof Object && 'errors' in error ? error.errors : error;
};

// Maria, where Directus takes the rule of her policy, or else the admin (V-114).
const user = () => (hasCustomPermissionRules() ? as('maria') : as('admin'));

describe('o resumo da consulta registrada (§7.1)', () => {
	it('até 10.000 itens, o total vem exato de uma vez, e é o número de itens do raio', async () => {
		const id = await registered(user(), { collection: 'occurrences', geo });
		const items = await user().request(
			customEndpoint<Item[]>({
				path: `/geospatial/queries/${id}/items`,
				method: 'GET',
				params: { limit: limitMaximum },
			}),
		);

		expect(items.length).toBeGreaterThan(0);
		expect(items.length).toBeLessThan(limitMaximum);
		expect(await summaryOf(user(), id)).toEqual({ total: items.length, exact: true, counting: false });
	});

	it('o público, que não lê as ocorrências, recebe no resumo o mesmo erro do /items', async () => {
		const id = await registered(user(), { collection: 'occurrences', geo });
		const items = await errorsOf(as('public').request(readItems('occurrences')));

		expect(await errorsOf(summaryOf(as('public'), id))).toEqual(items);
		expect(items).toMatchObject([{ extensions: { code: 'FORBIDDEN' } }]);
	});

	it('a URL não leva parâmetro do /items, que vai no registro, e um id esquecido volta com o de consulta desconhecida', async () => {
		const id = await registered(user(), { collection: 'occurrences', geo });

		expect(await errorOf(summaryOf(user(), id, { limit: 10 }))).toMatchObject({
			errors: [{ extensions: { code: 'INVALID_QUERY' } }],
			response: { status: 400 },
		});
		expect(await errorOf(summaryOf(user(), 'AAAAAAAAAAAAAAAAAAAAAA'))).toMatchObject({
			errors: [{ extensions: { code: 'GEOSPATIAL_UNKNOWN_QUERY' } }],
			response: { status: 404 },
		});
	});

	// In PostGIS, 12,000 points in the south zone and 3,000 in the north zone, about 10 m apart and up to 2 km from the
	// center, all inside the circle. By SQL, since through the API they would take minutes. SQLite only needs to go past
	// 10,000, and gets 10,500 points in the south zone, in two batches, each short enough for the other tests of the
	// combination, whose Directus waits a second for the file (V-180), and whose event loop another test measures.
	describe('acima de 10.000 itens', () => {
		const collection = 'summary_many';
		const [longitude, latitude] = circle.center;
		const question = { collection, geo };

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
			await untilKnown(collection);

			if (postgis) {
				await queryOn(
					databaseContainer(),
					`insert into ${collection} (region, geometry)
					select case when n < 12000 then 'south' else 'north' end,
						ST_SetSRID(ST_MakePoint(${String(longitude)} + (n % 100) * 0.0001, ${String(latitude)} + (n / 100) * 0.0001), 4326)
					from generate_series(0, 14999) as n`,
				);
			} else {
				await runOnSqlite(
					databaseContainer(),
					Array.from(
						{ length: 2 },
						(_, batch) =>
							`insert into ${collection} (region, geometry)
							with recursive n(i) as (select ${String(batch * 5250)} union all select i + 1 from n where i < ${String(batch * 5250 + 5249)})
							select 'south', MakePoint(${String(longitude)} + (i % 100) * 0.0001, ${String(latitude)} + (i / 100) * 0.0001, 4326)
							from n`,
					),
				);
			}

			// Maria reads the south zone of the collection too.
			if (hasCustomPermissionRules()) {
				const [policy] = await admin.request(readPolicies({ filter: { name: { _eq: 'South zone' } }, fields: ['id'] }));

				if (policy === undefined) {
					throw new Error('The seed did not create the policy of Maria.');
				}

				await admin.request(
					createPermission({ policy: policy.id, collection, action: 'read', fields: ['*'], permissions: southZone }),
				);
			}
		}, 120_000);

		it.runIf(postgis)(
			'o primeiro resumo traz 10.000+, e um pedido seguinte traz o total exato, quando a contagem termina',
			async () => {
				const id = await registered(as('admin'), { ...question, query: { fields: ['id'] } });

				expect(await summaryOf(as('admin'), id)).toEqual({ total: 10_000, exact: false, counting: true });
				expect(await exactSummaryOf(as('admin'), id)).toEqual({ total: 15_000, exact: true, counting: false });
			},
		);

		it.runIf(postgis && hasCustomPermissionRules())(
			'o total de um papel nunca aparece para outro com o mesmo id',
			async () => {
				const id = await registered(as('maria'), { ...question, query: { fields: ['id', 'region'] } });

				expect(await exactSummaryOf(as('maria'), id)).toEqual({ total: 12_000, exact: true, counting: false });
				expect(await exactSummaryOf(as('admin'), id)).toEqual({ total: 15_000, exact: true, counting: false });
				expect(await summaryOf(as('maria'), id)).toEqual({ total: 12_000, exact: true, counting: false });
			},
		);

		it.runIf(postgis)(
			'a contagem exata roda numa transação com o statement_timeout de 30 s, com que o Postgres a cancela além dele',
			async () => {
				const id = await registered(as('admin'), { ...question, query: { fields: ['region'] } });

				await exactSummaryOf(as('admin'), id);

				const statements = await as('admin').request(
					customEndpoint<string[] | null>({
						path: '/geospatial-test-observer/count',
						method: 'GET',
						params: { collection },
					}),
				);

				// The same transaction, by the id Knex gives it: the time maximum, and then the count, without a limit.
				expect(statements).toEqual([
					"select set_config('statement_timeout', '30000', true)",
					expect.stringMatching(
						new RegExp(
							String.raw`^select count\(\*\) as "count" from \(select 1 from .*"${collection}".* is not null\) as "c"$`,
						),
					),
				]);
			},
		);

		it.skipIf(postgis)(
			'no SQLite, fica o 10.000+, sem contar em segundo plano, que seguraria a conexão do Directus',
			async () => {
				const id = await registered(as('admin'), question);

				expect(await summaryOf(as('admin'), id)).toEqual({ total: 10_000, exact: false, counting: false });
				expect(await summaryOf(as('admin'), id)).toEqual({ total: 10_000, exact: false, counting: false });
			},
		);
	});
});

import type { Accountability, SchemaOverview } from '@directus/types';
import type { Internals, Radius } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import type { CircleEnvelope } from '../../db/adapter.js';
import { postgis } from '../../db/postgis.js';
import { spatialite } from '../../db/spatialite.js';
import type { Request } from '../../internals/chain.js';
import { database } from '../../internals/fake-directus.js';
import { memoryCounts } from '../../query/counts.js';
import type { RadiusRequest } from './items.js';
import { radiusLevels } from './levels.js';
import { radiusSummary, type Summing } from './summary.js';

const maria: Accountability = {
	role: 'operator',
	roles: ['operator'],
	user: 'maria',
	admin: false,
	app: true,
	ip: null,
};

const schema = {
	collections: {
		occurrences: {
			collection: 'occurrences',
			primary: 'id',
			fields: {
				id: { field: 'id', type: 'integer' },
				geometry: { field: 'geometry', type: 'geometry.Point' },
				region: { field: 'region', type: 'string' },
			},
		},
		directus_users: {
			collection: 'directus_users',
			primary: 'id',
			fields: { id: { field: 'id', type: 'uuid' }, location: { field: 'location', type: 'geometry.Point' } },
		},
	},
	relations: [],
} as unknown as SchemaOverview;

const geo: Radius = { operation: 'radius', center: [-46.7, -23.65], distance: 1000 };

// A statement of a count, which brings a total as Postgres hands a bigint, as text, in its transaction too. The rule of
// a policy goes in its values, as Directus writes it: the same SQL, region = ?, with another value (D-006).
const counting = (total: number | Promise<never>, rule: string) => {
	const rows = typeof total === 'number' ? Promise.resolve([{ count: String(total) }]) : total;

	return Object.assign(rows, {
		toSQL: () => ({ sql: 'select count(*) from circle where region = ?', bindings: [rule] }),
		transacting: () => rows,
	}) as unknown as Knex.QueryBuilder;
};

// A clock the test moves by hand, with the timers it fires when their time comes.
const fakeClock = () => {
	let time = 0;
	const timers: { at: number; run: () => void }[] = [];

	return {
		now: () => time,
		after: (ms: number, run: () => void) => {
			timers.push({ at: time + ms, run });
		},
		advance: (ms: number) => {
			time += ms;

			for (const timer of timers.filter(({ at }) => at <= time)) {
				timers.splice(timers.indexOf(timer), 1);
				timer.run();
			}
		},
	};
};

const settled = () => new Promise((resolve) => setImmediate(resolve));

// The engine of the summary over the fake Directus, with an adapter of PostGIS whose quick count brings quick and whose
// exact count brings exact, under the SQL of the rule of whoever asks, and which runs the exact count in its transaction.
const engineWith = ({
	quick,
	exact = 0,
	rule = 'south',
	overrides = {},
}: {
	quick: number;
	exact?: number | Promise<never>;
	rule?: string;
	overrides?: Partial<Summing>;
}) => {
	const built: Request[] = [];
	const bounds: number[] = [];
	const envelopes: CircleEnvelope[] = [];
	const clock = fakeClock();
	const warned: unknown[] = [];
	const engine: Summing = {
		knex: database,
		schema,
		client: 'postgres',
		internals: () => Promise.resolve({ status: 'accepted', adapter: '12' }),
		permittedQuery: (request, _, queryOf = (hooked) => hooked) => {
			built.push({ ...request, query: queryOf(request.query) });

			return Promise.resolve({
				builder: database.select('id').from('occurrences'),
				query: request.query,
				fields: ['id'],
			});
		},
		logger: { error: () => undefined },
		defaultLimit: 100,
		levels: {
			...radiusLevels,
			postgres: {
				level: 'indexed',
				adapter: {
					...postgis,
					columnOf: () => Promise.resolve({ type: 'geometry', srid: 4326 }),
					boxesIn: () => Promise.resolve(null),
					count: (_, envelope, limit) => {
						envelopes.push(envelope);

						return limit === undefined ? counting(exact, rule) : counting(Math.min(quick, limit), rule);
					},
					bounded: (_, timeout, read) => {
						bounds.push(timeout);

						return read({} as Knex.Transaction);
					},
				},
			},
		},
		counts: memoryCounts({
			timeout: 30_000,
			retention: 5 * 60 * 1000,
			concurrency: 2,
			entries: 100,
			now: clock.now,
			after: clock.after,
			logger: { warn: (error: unknown) => warned.push(error) },
		}),
		...overrides,
	};

	return { engine, built, bounds, envelopes, clock, warned };
};

const summaryWith = (request: Partial<RadiusRequest>, engine: Summing) =>
	radiusSummary({ collection: 'occurrences', geo, page: { fields: ['*'] }, accountability: maria, ...request }, engine);

const refused: Internals = { status: 'refused', problems: { '12': ['missing'] } };

describe('o resumo do raio, em dois tempos (§7.1)', () => {
	it('até 10.000 itens, o total vem exato de uma vez, sem a contagem em segundo plano', async () => {
		const { engine, bounds, envelopes, built } = engineWith({ quick: 10_000 });

		expect(await summaryWith({}, engine)).toEqual({ data: { total: 10_000, exact: true, counting: false } });
		expect(bounds).toEqual([]);
		expect(envelopes).toHaveLength(1);
		// The circle goes around the permitted query, with the geometry by its name.
		expect(envelopes[0]).toMatchObject({ collection: 'occurrences', geometry: 'geometry', center: geo.center });
		expect(built.map(({ query }) => query.fields)).toEqual([['*', 'geometry']]);
	});

	it('acima disso, o primeiro resumo traz 10.000+, e um pedido seguinte traz o total exato, contado com o tempo máximo', async () => {
		const { engine, bounds } = engineWith({ quick: 50_000, exact: 512_340 });

		expect(await summaryWith({}, engine)).toEqual({ data: { total: 10_000, exact: false, counting: true } });

		await settled();

		expect(await summaryWith({}, engine)).toEqual({ data: { total: 512_340, exact: true, counting: false } });
		expect(bounds).toEqual([30_000]);
	});

	it('com o tempo máximo estourado, fica o 10.000+, sem contar de novo a cada pedido', async () => {
		const { engine, clock, bounds } = engineWith({ quick: 50_000, exact: new Promise<never>(() => undefined) });

		await summaryWith({}, engine);
		clock.advance(30_000);

		expect(await summaryWith({}, engine)).toEqual({ data: { total: 10_000, exact: false, counting: false } });
		expect(bounds).toEqual([30_000]);
	});

	it('o banco que cancela a contagem pelo tempo máximo deixa o 10.000+, com um aviso no log', async () => {
		const canceled = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
		const { engine, warned } = engineWith({ quick: 50_000, exact: Promise.reject(canceled) });

		await summaryWith({}, engine);
		await settled();

		expect(await summaryWith({}, engine)).toEqual({ data: { total: 10_000, exact: false, counting: false } });
		expect(warned).toEqual([canceled]);
	});

	it('o total exato de uma regra nunca responde por outra, porque a chave é o SQL com os valores dela', async () => {
		const ofMaria = engineWith({ quick: 50_000, exact: 12_000, rule: 'south' });
		const { engine } = ofMaria;

		await summaryWith({}, engine);
		await settled();

		const ofAnother = engineWith({ quick: 50_000, exact: 15_000, rule: 'north', overrides: { counts: engine.counts } });

		expect(await summaryWith({}, ofAnother.engine)).toEqual({ data: { total: 10_000, exact: false, counting: true } });
		expect(await summaryWith({}, engine)).toEqual({ data: { total: 12_000, exact: true, counting: false } });

		await settled();

		expect(await summaryWith({}, ofAnother.engine)).toEqual({ data: { total: 15_000, exact: true, counting: false } });
	});

	it('onde o banco não limita um comando no tempo, fica o 10.000+, sem contar em segundo plano', async () => {
		const { engine } = engineWith({ quick: 50_000 });
		const sqlite = {
			level: 'capped' as const,
			adapter: {
				...spatialite,
				measures: () => Promise.resolve(true),
				count: () => counting(10_001, 'south'),
			},
		};

		expect(await summaryWith({}, { ...engine, client: 'sqlite', levels: { ...engine.levels, sqlite } })).toEqual({
			data: { total: 10_000, exact: false, counting: false },
		});
	});

	it('onde o banco só mede pontos, um campo que não é ponto volta indisponível, depois da cadeia', async () => {
		const { engine, built } = engineWith({ quick: 1 });
		const sqlite = { level: 'capped' as const, adapter: { ...spatialite, measures: () => Promise.resolve(false) } };

		await expect(
			summaryWith({}, { ...engine, client: 'sqlite', levels: { ...engine.levels, sqlite } }),
		).rejects.toMatchObject({ code: 'GEOSPATIAL_OPERATION_UNAVAILABLE' });
		expect(built).toHaveLength(1);
	});

	it('o banco que não responde à contagem rápida faz o resumo falhar fechado', async () => {
		const { engine } = engineWith({ quick: 1 });
		const down = {
			level: 'indexed' as const,
			adapter: {
				...postgis,
				columnOf: () => Promise.reject(new Error('Connection terminated')),
			},
		};

		await expect(summaryWith({}, { ...engine, levels: { ...engine.levels, postgres: down } })).rejects.toMatchObject({
			code: 'GEOSPATIAL_DATABASE_UNAVAILABLE',
		});
	});

	it.each([
		['um parâmetro que o raio ainda não trata', { page: { fields: ['*'], group: ['region'] } }, {}, 'INVALID_QUERY'],
		['os internos recusados', {}, { internals: () => Promise.resolve(refused) }, 'GEOSPATIAL_INTERNALS_UNSUPPORTED'],
		['um banco onde o raio não roda', {}, { client: 'mysql' as const }, 'GEOSPATIAL_OPERATION_UNAVAILABLE'],
		['uma coleção do sistema, mesmo com uma geometria', { collection: 'directus_users' }, {}, 'FORBIDDEN'],
	])('%s volta com o erro, sem montar a query permitida', async (_, request, overrides, code) => {
		const { engine, built } = engineWith({ quick: 1, overrides });

		await expect(summaryWith(request, engine)).rejects.toMatchObject({ code });
		expect(built).toEqual([]);
	});
});

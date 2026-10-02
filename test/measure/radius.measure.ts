import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from '../combinations.ts';
import { hasCustomPermissionRules, versions } from '../directus.ts';
import { log, seconds } from '../environment.ts';
import { queryOn } from '../postgres.ts';
import { circle } from '../seed.ts';
import { machineOf, method, planOf, quick, resultsOf, series, summaryOf, summaryOfPlan } from './measure.ts';

const combination = inject('combination');

const { keep, keepPlan } = resultsOf(combination);

// The radius with volume runs on Directus 11.17, with the oldest and the newest PostGIS, and the permitted query on
// every combination of the run (F02-07).
const withVolume = combinations[combination].directus.version.startsWith('11.');

// The volumes of the radius, past the items of the seed.
const volumes = quick ? [10_000] : [10_000, 1_000_000];

// The two pages of the radius of Maria: the first, of 100 items, as /items gives without a limit, and the whole circle.
// Each page says its limit, since the radius reads a page without one as the whole circle.
const pages = { first: 100, whole: -1 };

const geo = { operation: 'radius', center: circle.center, distance: circle.meters };

// The points follow a normal distribution around the center of São Paulo, with 0.5° of deviation, about 55 km, dense
// in the center and sparse at the edge, as the occurrences of a city, and half of them are in the south zone, which
// Maria reads (F01-16). The circle of the radius, in the south zone, holds about 1.6% of them.
const center: [number, number] = [-46.63, -23.55];
const spread = 0.5;

// The Directus of the combination, and the container of its database, where the volume and the plans go by psql.
const started = () => {
	const directus = inject('directus')[combination];

	if (directus?.databaseContainer === undefined) {
		throw new Error(`The global setup did not start the combination ${combination} with a database container.`);
	}

	return { ...directus, container: directus.databaseContainer };
};

const sql = (text: string) => queryOn(started().container, text);

// What the observer timed inside Directus of the last read of the radius (test/measure/observer/).
const observed = async () => {
	const { url, tokens } = started();
	const response = await fetch(`${url}/geospatial-test-observer/last`, {
		headers: { Authorization: `Bearer ${tokens.admin}` },
	});
	const { data } = (await response.json()) as { data: { build: number; database: number; statement: string } | null };

	if (data === null) {
		throw new Error('The observer timed no read of the radius.');
	}

	return data;
};

// One request of the radius of Maria, with the time of the whole request, measured from here, and what the observer
// timed inside Directus: building the permitted query and the database.
const radiusOf = async (limit: number) => {
	const { url, tokens } = started();
	const params = new URLSearchParams({ geo: JSON.stringify(geo), fields: '*', limit: String(limit) });
	const startedAt = performance.now();
	const response = await fetch(`${url}/geospatial/items/occurrences?${params.toString()}`, {
		headers: { Authorization: `Bearer ${tokens.maria}` },
	});
	const body = await response.text();
	const total = performance.now() - startedAt;

	if (!response.ok) {
		throw new Error(`The radius answered ${String(response.status)}: ${body}`);
	}

	const { data } = JSON.parse(body) as { data: unknown[] };

	return { total, ...(await observed()), items: data.length };
};

// A series of one page, with the plan of the statement of its last request, as the database runs it.
const seriesOf = async (name: string, limit: number) => {
	const measured = await series(() => radiusOf(limit));
	const last = measured.at(-1);

	if (last === undefined) {
		throw new Error('The series measured no request.');
	}

	const plan = await planOf(started().container, last.statement);

	await keepPlan(name, plan);

	return {
		items: last.items,
		total: summaryOf(measured.map(({ total }) => total)),
		build: summaryOf(measured.map(({ build }) => build)),
		database: summaryOf(measured.map(({ database }) => database)),
		plan: summaryOfPlan(plan),
	};
};

const pagesOf = async (name: string) => ({
	first: await seriesOf(`${name}-first`, pages.first),
	whole: await seriesOf(`${name}-whole`, pages.whole),
});

// Adds the points up to the volume by SQL, into the column Directus created, since through the API a million would take
// about 30 min (V-164). The seed of the random numbers makes the same points on each run of the same Postgres.
const fill = async (volume: number) => {
	const missing = volume - Number(await sql('select count(*) from occurrences'));

	if (missing > 0) {
		await sql(
			`select setseed(${String(volume / 1e7)}); insert into occurrences (region, category, status, occurred_at, geometry)
			select case when random() < 0.5 then 'south' else 'north' end, 'theft', 'open',
				timestamp '2026-09-01' + random() * interval '30 days',
				ST_SetSRID(ST_MakePoint(
					${String(center[0])} + ${String(spread)} * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()),
					${String(center[1])} + ${String(spread)} * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())
				), 4326)
			from generate_series(1, ${String(missing)})`,
		);
	}

	await sql('vacuum analyze occurrences');
};

describe.runIf(combinations[combination].database.client === 'postgres')('as medições do raio (F02-07)', () => {
	beforeAll(async () => {
		await keep('machine', await machineOf(started().container));
		await keep('versions', versions());
		await keep('method', { ...method, quick });
	});

	// Building the permitted query does not depend on the rows, since nothing runs on the database: the hooks of
	// items.query and the chain of the ItemsService, up to the statement of the radius (V-164).
	it.runIf(hasCustomPermissionRules())(
		'montar a query permitida da Maria custa poucos ms por pedido',
		async () => {
			const permitted = await seriesOf('permitted', pages.first);

			await keep('permitted', permitted);
			log(`${combination}: the permitted query of Maria, ${JSON.stringify(permitted.build)} ms`);
			expect(permitted.build.median).toBeGreaterThan(0);
		},
		300_000,
	);

	describe.runIf(withVolume)('o raio da Maria com volume', () => {
		for (const volume of volumes) {
			it(`com ${String(volume)} pontos, sem e com o GiST`, async () => {
				await sql('drop index concurrently if exists occurrences_geometry_gist');

				const loadedAt = performance.now();

				await fill(volume);

				const loadSeconds = Number(seconds(loadedAt));
				const withoutIndex = await pagesOf(`${String(volume)}-without-gist`);
				const indexedAt = performance.now();

				// The index the extension offers the admin to create (§7.6), without locking the table.
				await sql('create index concurrently occurrences_geometry_gist on occurrences using gist (geometry)');

				const indexSeconds = Number(seconds(indexedAt));

				await sql('analyze occurrences');

				const withIndex = await pagesOf(`${String(volume)}-with-gist`);

				// The index changes how the database finds the items, and never which ones.
				expect(withIndex.first.items).toBe(withoutIndex.first.items);
				expect(withIndex.whole.items).toBe(withoutIndex.whole.items);

				const sizes = await sql(
					"select pg_size_pretty(pg_table_size('occurrences')) || ' | ' || pg_size_pretty(pg_relation_size('occurrences_geometry_gist'))",
				);
				const measured = { loadSeconds, withoutIndex, indexSeconds, withIndex, sizes };

				await keep(`volume ${String(volume)}`, measured);
				log(`${combination}: the radius of Maria with ${String(volume)} points, ${JSON.stringify(measured)}`);
			}, 3_600_000);
		}
	});
});

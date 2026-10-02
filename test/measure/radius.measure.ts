import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from '../combinations.ts';
import { hasCustomPermissionRules, versions } from '../directus.ts';
import { log, seconds } from '../environment.ts';
import { queryOn } from '../postgres.ts';
import { circle } from '../seed.ts';
import { machineOf, method, planOf, quick, resultsOf, series, summaryOf, summaryOfPlan, timesOf } from './measure.ts';

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

// A series of one page, with the plan of the statement of its last request, as the database runs it, and the statement,
// which the options of the envelope start from.
const seriesOf = async (name: string, limit: number) => {
	const measured = await series(() => radiusOf(limit));
	const last = measured.at(-1);

	if (last === undefined) {
		throw new Error('The series measured no request.');
	}

	const plan = await planOf(started().container, last.statement);

	await keepPlan(name, plan);

	return {
		statement: last.statement,
		summary: {
			items: last.items,
			total: summaryOf(measured.map(({ total }) => total)),
			build: summaryOf(measured.map(({ build }) => build)),
			database: summaryOf(measured.map(({ database }) => database)),
			plan: summaryOfPlan(plan),
		},
	};
};

const pagesOf = async (name: string) => {
	const first = await seriesOf(`${name}-first`, pages.first);
	const whole = await seriesOf(`${name}-whole`, pages.whole);

	return {
		statements: { first: first.statement, whole: whole.statement },
		summary: { first: first.summary, whole: whole.summary },
	};
};

// The pieces of the statement of the radius around the permitted query, as the envelope of PostGIS writes it
// (testdata/sql/radius-postgis.sql), and of the permitted query, as Directus writes it.
const around = { start: 'select "p".* from (', exact: ') as "p" where ', order: ' order by "p"."id" asc' };
const inside = { where: ' from "occurrences" where ', order: ' order by "occurrences"."id" asc' };

// Splits a text at a piece that must be in it once, so a statement of another shape fails the measurement instead of
// measuring something else.
const splitAt = (text: string, piece: string): [string, string] => {
	const at = text.indexOf(piece);

	if (at === -1 || text.includes(piece, at + 1)) {
		throw new Error(`The statement does not hold "${piece}" once: ${text}`);
	}

	return [text.slice(0, at), text.slice(at + piece.length)];
};

// The statement of the radius in parts: the columns, the rule and the order of the permitted query, and the exact test
// and the page around it.
const partsOf = (statement: string) => {
	const [, rest] = splitAt(statement, around.start);
	const [permitted, outside] = splitAt(rest, around.exact);
	const [exact, page] = splitAt(outside, around.order);
	const [columns, ruled] = splitAt(permitted, inside.where);
	const [rule, order] = splitAt(ruled, inside.order);

	return { columns, rule, order, exact, page };
};

// The box of the circle in degrees, which always holds it: a degree of latitude is at least 110,574 m long, and one of
// longitude at least that times the cosine of the latitude, taken where the circle gets farthest from the equator,
// with 1% to spare (§7.6).
const box = (() => {
	const [longitude, latitude] = circle.center;
	const dy = (circle.meters / 110_574) * 1.01;
	const dx = dy / Math.cos((Math.min(89.9, Math.abs(latitude) + dy) * Math.PI) / 180);

	return `ST_MakeEnvelope(${[longitude - dx, latitude - dy, longitude + dx, latitude + dy].map(String).join(', ')}, 4326)`;
})();

const exactOnTheColumn = `ST_DWithin("occurrences"."geometry"::geography, ST_SetSRID(ST_MakePoint(${circle.center.map(String).join(', ')}), 4326)::geography, ${String(circle.meters)})`;

// The statement of the radius with the permitted query given more conditions, with or without its order, and another
// test around it.
const rewrite = (
	statement: string,
	{ more, keepOrder, exact }: { more: string; keepOrder: boolean; exact?: string },
) => {
	const parts = partsOf(statement);
	const rule = more === '' ? parts.rule : `(${parts.rule})${more}`;
	const order = keepOrder ? `${inside.order}${parts.order}` : parts.order;

	return `${around.start}${parts.columns}${inside.where}${rule}${order}${around.exact}${exact ?? parts.exact}${around.order}${parts.page}`;
};

// The ways the envelope can read the geometry (F02-08). Both options put the box inside the permitted query, as one
// more condition of its where, since the order Directus gives every permitted query keeps Postgres from pulling the
// subquery up, and a condition around it never reaches the column. The box only discards candidates, and what goes out
// is still decided by the value the permitted query exposes, which a policy leaves null where it hides the geometry.
const options = {
	// The envelope as it is: the exact test on the text the permitted query exposes, without the index (A-023).
	current: (statement: string, keepOrder: boolean) => rewrite(statement, { more: '', keepOrder }),
	// The box on the column, with the index, and the exact test on the text the permitted query exposes (A-023).
	boxOnTheColumn: (statement: string, keepOrder: boolean) =>
		rewrite(statement, { more: ` and "occurrences"."geometry" && ${box}`, keepOrder }),
	// The box and the exact test on the column, where the value the permitted query exposes is not null (A-026).
	exactOnTheColumn: (statement: string, keepOrder: boolean) =>
		rewrite(statement, {
			more: ` and "occurrences"."geometry" && ${box} and ${exactOnTheColumn}`,
			keepOrder,
			exact: '"p"."geometry" is not null',
		}),
};

// How many items a statement returns, and which, so each option is held to the radius as it is.
const idsOf = (statement: string) =>
	sql(
		`select count(*) || ' ' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from (${statement}) as radius`,
	);

// Each option on the database, with the JIT and without it, on both pages, and, with the GiST, also without the order
// Directus gives the permitted query, which the order around it repeats (V-153).
const optionsOf = async (name: string, statements: Record<keyof typeof pages, string>, indexed: boolean) => {
	const measured: Record<string, unknown> = {};
	const variants = {
		jit: { keepOrder: true, settings: [] },
		withoutJit: { keepOrder: true, settings: ['set jit = off'] },
		...(indexed && { withoutInnerOrder: { keepOrder: false, settings: [] } }),
	};

	for (const [page, radius] of Object.entries(statements)) {
		const expected = await idsOf(radius);

		for (const [option, build] of Object.entries(options)) {
			for (const [variant, { keepOrder, settings }] of Object.entries(variants)) {
				const statement = build(radius, keepOrder);

				expect(await idsOf(statement)).toBe(expected);

				const plan = await planOf(started().container, statement, settings);

				await keepPlan(`${name}-${page}-${option}-${variant}`, plan);
				measured[`${page} ${option} ${variant}`] = {
					database: await timesOf(started().container, statement, settings),
					plan: summaryOfPlan(plan),
				};
			}
		}
	}

	return measured;
};

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
			const { summary: permitted } = await seriesOf('permitted', pages.first);

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
				const optionsWithoutIndex = await optionsOf(`${String(volume)}-without-gist`, withoutIndex.statements, false);
				const indexedAt = performance.now();

				// The index the extension offers the admin to create (§7.6), without locking the table.
				await sql('create index concurrently occurrences_geometry_gist on occurrences using gist (geometry)');

				const indexSeconds = Number(seconds(indexedAt));

				await sql('analyze occurrences');

				const withIndex = await pagesOf(`${String(volume)}-with-gist`);
				const optionsWithIndex = await optionsOf(`${String(volume)}-with-gist`, withIndex.statements, true);

				// The index changes how the database finds the items, and never which ones.
				expect(withIndex.summary.first.items).toBe(withoutIndex.summary.first.items);
				expect(withIndex.summary.whole.items).toBe(withoutIndex.summary.whole.items);

				const sizes = await sql(
					"select pg_size_pretty(pg_table_size('occurrences')) || ' | ' || pg_size_pretty(pg_relation_size('occurrences_geometry_gist'))",
				);
				const measured = {
					loadSeconds,
					withoutIndex: withoutIndex.summary,
					optionsWithoutIndex,
					indexSeconds,
					withIndex: withIndex.summary,
					optionsWithIndex,
					sizes,
				};

				await keep(`volume ${String(volume)}`, measured);
				log(`${combination}: the radius of Maria with ${String(volume)} points, ${JSON.stringify(measured)}`);
			}, 3_600_000);
		}
	});
});

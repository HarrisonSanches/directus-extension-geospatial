import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createItems, createPreset, customEndpoint, readMe } from '@directus/sdk';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { Browser, Page } from 'playwright-core';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from '../test/combinations.ts';
import { as, connect, hasCustomPermissionRules, versions } from '../test/directus.ts';
import { type Environment, extension, log, newSecret, startEnvironment } from '../test/environment.ts';
import { seed } from '../test/seed.ts';
import { startBrowser } from './browser.ts';
import { basemap, marks, tileQueryKey, view, viewKey } from './layout/src/view.ts';

// The measurements of F01 take minutes and a million rows, so they run only when asked, with SPIKE_MEASURE=1 and one
// combination at a time, since two databases measured side by side share the processor (F01-16).
const measuring = process.env.SPIKE_MEASURE === '1';

const combination = inject('combination');

// The numbers of the run, which the proof writes to test-results/f01-16, out of Git, beside what it logs.
const results: Record<string, unknown> = {};

const folder = fileURLToPath(new URL('../test-results/f01-16/', import.meta.url));

const keep = async (name: string, value: unknown) => {
	results[name] = value;
	await mkdir(folder, { recursive: true });
	await writeFile(`${folder}${combination}.json`, `${JSON.stringify(results, null, '\t')}\n`);
};

// The median and the 95th percentile, by the nearest rank, of a series of times, in milliseconds.
const summaryOf = (times: number[]) => {
	const sorted = [...times].sort((a, b) => a - b);
	const rank = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;
	const round = (value: number) => Math.round(value * 10) / 10;

	return { runs: sorted.length, median: round(rank(0.5)), p95: round(rank(0.95)), max: round(sorted.at(-1) ?? 0) };
};

// Each series warms up first, so the first requests, which load the schema, the permissions and the pages of the table,
// stay out of it.
const warmUps = 3;
const runs = 20;

const series = async <T>(measure: () => Promise<T>): Promise<T[]> => {
	for (let run = 0; run < warmUps; run += 1) {
		await measure();
	}

	const measured: T[] = [];

	for (let run = 0; run < runs; run += 1) {
		measured.push(await measure());
	}

	return measured;
};

describe.runIf(measuring && combinations[combination].database.client === 'postgres')(
	'as medições da F01 (F01-16)',
	() => {
		// The cost of the permitted query does not depend on the rows, since nothing runs: the schema, the permissions, the
		// hooks and the chain of the ItemsService (F01-02). The radius route hands it back with its answer.
		it.runIf(hasCustomPermissionRules())(
			'montar a query permitida da Maria custa poucos ms por pedido',
			async () => {
				const buildOf = async () =>
					(
						await as('maria').request(
							customEndpoint<{ buildMs: number }>({
								path: '/geospatial-spikes/radius/occurrences',
								method: 'GET',
								params: { longitude: -46.7, latitude: -23.65, meters: 10_000 },
							}),
						)
					).buildMs;
				const build = summaryOf(await series(buildOf));

				await keep('build', { directus: versions().directus, ...build });
				log(`${combination}: building the permitted query of Maria takes ${JSON.stringify(build)} ms`);
				expect(build.median).toBeGreaterThan(0);
			},
			120_000,
		);

		describe.runIf(combinations[combination].directus.version.startsWith('11.'))('o tile com volume', () => {
			let environment: Environment | undefined;
			let maria = '';

			const started = () => {
				const database = environment?.backend.database;

				if (environment === undefined || database === undefined) {
					throw new Error('The Directus of the measurements did not start.');
				}

				return { ...environment, database };
			};

			const sql = (text: string) => psql(started().database, text);

			beforeAll(async () => {
				environment = await startEnvironment(combination, inject('coverage'), `${combination}-measure`, [
					extension,
					'spikes/extension',
					'spikes/layout',
				]);
				({ maria } = await seed(connect(environment.url, environment.admin.token), newSecret, true));
				await keep('machine', await machineOf(started().database));
			}, 900_000);

			afterAll(async () => {
				await environment?.stop();
			}, 300_000);

			it('pela API, o volume entra devagar demais para um milhão de itens', async () => {
				const admin = connect(started().url, started().admin.token);
				const random = generator(16);
				const batch = 500;
				const total = 5000;
				const startedAt = performance.now();

				for (let done = 0; done < total; done += batch) {
					await admin.request(
						createItems(
							'occurrences',
							Array.from({ length: batch }, () => ({
								region: random() < 0.5 ? 'south' : 'north',
								category: 'theft',
								status: 'open',
								occurred_at: '2026-09-01T00:00:00Z',
								geometry: { type: 'Point' as const, coordinates: aroundSaoPaulo(random) },
							})),
						),
					);
				}

				const perSecond = total / ((performance.now() - startedAt) / 1000);

				await keep('api', {
					items: total,
					batch,
					perSecond: Math.round(perSecond),
					millionMinutes: Math.round(1e6 / perSecond / 60),
				});
				log(
					`${combination}: the API takes ${String(Math.round(perSecond))} items a second, and a million in ${String(Math.round(1e6 / perSecond / 60))} min`,
				);
			}, 600_000);

			for (const volume of volumes) {
				it(`o tile da Maria com ${String(volume)} pontos, sem e com o pré-filtro pela caixa do tile`, async () => {
					await sql('drop index concurrently if exists occurrences_geometry_gist');

					const loadedAt = performance.now();

					await fill(volume);

					const loadSeconds = (performance.now() - loadedAt) / 1000;
					const measured: Record<string, unknown> = { loadSeconds: Math.round(loadSeconds * 10) / 10 };

					// First the tile of F01-13 as it is, which reads the whole permitted query, with no index on the column.
					measured.whole = await tilesOf('whole', volume);

					const indexedAt = performance.now();

					// The index the extension offers the admin to create (§7.6), without locking the table.
					await sql('create index concurrently occurrences_geometry_gist on occurrences using gist (geometry)');
					measured.indexSeconds = Math.round((performance.now() - indexedAt) / 100) / 10;
					await sql('analyze occurrences');
					measured.prefiltered = await tilesOf('prefiltered', volume);
					measured.sizes = await sql(
						"select pg_size_pretty(pg_table_size('occurrences')) || ' | ' || pg_size_pretty(pg_relation_size('occurrences_geometry_gist'))",
					);
					await keep(`volume ${String(volume)}`, measured);
					log(`${combination}: ${String(volume)} points, ${JSON.stringify(measured)}`);
				}, 3_600_000);
			}

			// The first request after the database restarts, with its buffers empty. The operating system keeps its own cache
			// of the files, which no container empties, so it is cold only for Postgres.
			it('o primeiro tile depois de reiniciar o Postgres, sem e com o pré-filtro', async () => {
				const cold: Record<string, unknown> = {};

				for (const variant of variantNames) {
					await restart(started().database);
					await untilDirectusReads();

					const { body, ...timings } = await tileOf(zooms[0] ?? 0, variant);

					cold[variant] = { ...timings, features: featuresOf(body).length };
				}

				await keep('cold', cold);
				log(`${combination}: the first tile after a restart of Postgres, ${JSON.stringify(cold)}`);
			}, 600_000);

			describe('o tempo até o primeiro tile no layout', () => {
				let browser: Browser;
				let stop: () => Promise<void>;

				beforeAll(async () => {
					({ browser, stop } = await startBrowser());

					const admin = connect(started().url, started().admin.token);
					const me = await admin.request(readMe({ fields: ['id'] }));

					await admin.request(createPreset({ collection: 'occurrences', layout: 'geospatial-spike-map', user: me.id }));
				}, 900_000);

				afterAll(async () => {
					await stop();
				});

				it('com o mapa de fundo em branco, sem e com o limite de rede, sem e com o pré-filtro', async () => {
					const loads: Record<string, unknown> = {};

					for (const [name, target] of Object.entries(views)) {
						for (const network of Object.keys(networks) as (keyof typeof networks)[]) {
							for (const variant of variantNames) {
								loads[`${name}, ${network}, ${variant}`] = await firstTileOf(browser, {
									target,
									network,
									variant,
									blank: true,
								});
							}
						}
					}

					await keep('browser', loads);
					log(`${combination}: the way to the first tile, ${JSON.stringify(loads)}`);
				}, 1_800_000);

				it('com o mapa de fundo do OpenFreeMap, pela rede, à parte', async () => {
					const openFreeMap = await firstTileOf(browser, {
						target: views.street,
						network: 'unlimited',
						variant: 'prefiltered',
						blank: false,
					});

					await keep('browser with OpenFreeMap', openFreeMap);
					log(`${combination}: with the basemap of OpenFreeMap, ${JSON.stringify(openFreeMap)}`);
				}, 600_000);
			});

			// The tile of the south zone of Maria where the points are densest, at a zoom, with the time it took, measured
			// from the tests, and the time to build the permitted query and the time of the database, from the header of the
			// route.
			const tileOf = async (z: number, variant: Variant) => {
				const { x, y } = tileAt(z, center);
				const address = `${started().url}/geospatial-spikes/tile/occurrences/${String(z)}/${String(x)}/${String(y)}${variant === 'prefiltered' ? '?prefilter=box' : ''}`;
				const startedAt = performance.now();
				const response = await fetch(address, { headers: { Authorization: `Bearer ${maria}` } });
				const body = Buffer.from(await response.arrayBuffer());
				const milliseconds = performance.now() - startedAt;

				if (!response.ok) {
					throw new Error(`The tile ${address} answered ${String(response.status)}: ${body.toString()}`);
				}

				return {
					milliseconds,
					...serverTimingOf(response.headers.get('Server-Timing') ?? ''),
					bytes: body.length,
					body,
				};
			};

			// The features of the tile at each zoom, from the first variant measured at the volume, for the second to match: the
			// prefilter only drops candidates, and the tile stays the same.
			let features: Record<string, string[]> = {};

			// Each zoom, in the series of the variant, with the plan of the tile of the last request, as the database ran it.
			const tilesOf = async (variant: Variant, volume: number) => {
				const byZoom: Record<string, unknown> = {};

				for (const z of zooms) {
					const measured = await series(() => tileOf(z, variant));
					const last = measured.at(-1);

					if (last === undefined) {
						throw new Error('The series measured no tile.');
					}

					const statement = await connect(started().url, started().admin.token).request(
						customEndpoint<string>({ path: '/geospatial-spikes/tile-statement', method: 'GET' }),
					);
					const plan = await sql(`explain (analyze, buffers) ${statement}`);

					await mkdir(`${folder}${combination}/`, { recursive: true });
					await writeFile(`${folder}${combination}/plan-${String(volume)}-${variant}-z${String(z)}.txt`, `${plan}\n`);
					features[String(z)] ??= featuresOf(last.body);
					expect(featuresOf(last.body)).toEqual(features[String(z)]);
					byZoom[`z${String(z)}`] = {
						total: summaryOf(measured.map(({ milliseconds }) => milliseconds)),
						build: summaryOf(measured.map(({ build }) => build)),
						database: summaryOf(measured.map(({ database }) => database)),
						bytes: last.bytes,
						features: featuresOf(last.body).length,
						plan: summaryOfPlan(plan),
					};
				}

				return byZoom;
			};

			const countOf = async () => Number(await sql('select count(*) from occurrences'));

			// Adds the points up to the volume, around São Paulo, by SQL, into the column Directus created. The seed of the random
			// numbers makes the same points on each run of the same Postgres.
			const fill = async (volume: number) => {
				const missing = volume - (await countOf());

				features = {};

				if (missing > 0) {
					await sql(
						`select setseed(${String(volume / 1e7)}); insert into occurrences (region, category, status, occurred_at, geometry)
					select case when random() < 0.5 then 'south' else 'north' end, 'theft', 'open', timestamp '2026-09-01' + random() * interval '30 days',
						ST_SetSRID(ST_MakePoint(
							${String(center[0])} + ${String(spread)} * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()),
							${String(center[1])} + ${String(spread)} * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())
						), 4326)
					from generate_series(1, ${String(missing)})`,
					);
				}

				await sql('vacuum analyze occurrences');
			};

			// Directus reconnects after the restart, and a read of its own tables stands between the two.
			const untilDirectusReads = async () => {
				const deadline = Date.now() + 60_000;

				while (Date.now() < deadline) {
					const response = await fetch(`${started().url}/users/me`, {
						headers: { Authorization: `Bearer ${started().admin.token}` },
					}).catch(() => undefined);

					if (response?.ok === true) {
						return;
					}

					await setTimeout(500);
				}

				throw new Error('Directus did not read the database again within 60 s.');
			};

			// A page of the Studio on the layout, with the view and the tiles of the load, and the way to the first tile: the
			// moments the layout marked, and each file and tile the page downloaded, with its time and its size.
			const firstTileOf = async (
				current: Browser,
				{
					target,
					network,
					variant,
					blank,
				}: { target: typeof view; network: keyof typeof networks; variant: Variant; blank: boolean },
			) => {
				const context = await current.newContext();

				await context.addCookies(dismissed.map((name) => ({ name, value: 'true', url: started().url })));
				await context.addInitScript(
					([viewName, viewValue, queryName, queryValue]) => {
						localStorage.setItem(viewName, viewValue);
						localStorage.setItem(queryName, queryValue);
					},
					[viewKey, JSON.stringify(target), tileQueryKey, variant === 'prefiltered' ? 'prefilter=box' : ''] as const,
				);

				// A style with a background and nothing else, so the basemap asks for nothing outside Directus.
				if (blank) {
					await context.route(basemap, (route) =>
						route.fulfill({
							json: {
								version: 8,
								sources: {},
								layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef1f4' } }],
							},
						}),
					);
				}

				const login = await context.request.post(`${started().url}/auth/login`, {
					data: { email: started().admin.email, password: started().admin.password, mode: 'session' },
				});

				expect(login.ok()).toBe(true);

				const page = await context.newPage();
				const downloads = watchDownloads(page);
				const cdp = await context.newCDPSession(page);

				await cdp.send('Network.enable');
				await cdp.send('Network.emulateNetworkConditions', { offline: false, ...networks[network] });
				await page.goto(`${started().url}/admin/content/occurrences`);
				await page.waitForFunction((name) => performance.getEntriesByName(name).length > 0, marks.tiles, {
					timeout: 300_000,
				});

				const moments = await page.evaluate(() =>
					Object.fromEntries(
						performance
							.getEntriesByType('mark')
							.filter(({ name }) => name.startsWith('geospatial-spike:'))
							.map(({ name, startTime }) => [name.slice('geospatial-spike:'.length), Math.round(startTime)]),
					),
				);

				await page.waitForLoadState('networkidle');

				const downloaded = await downloads();

				await context.close();

				return { moments, downloads: downloaded };
			};
		});
	},
);

// The volumes of the measurements, with the points of the API among the first.
const volumes = [10_000, 100_000, 1_000_000];

// A zoom of the whole state, of the city, of a district and of a street.
const zooms = [4, 8, 12, 16];

type Variant = 'whole' | 'prefiltered';

const variantNames: Variant[] = ['whole', 'prefiltered'];

// The points follow a normal distribution around the center of São Paulo, with 0.5° of deviation, about 55 km, dense
// in the center and sparse at the edge, as the occurrences of a city.
const center: [number, number] = [-46.63, -23.55];
const spread = 0.5;

// The layout opens on the street of the proofs of F01-15, and on the whole city, as a layout that fits the collection.
const views = { street: view, city: { center, zoom: 8 } };

// The network of the page: the local one, and the desktop profile of Lighthouse, 10 Mbit/s with 40 ms of round trip.
const networks = {
	unlimited: { latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
	desktop: { latency: 40, downloadThroughput: (10_240 * 1024) / 8, uploadThroughput: (10_240 * 1024) / 8 },
};

// The license dialogs of the Studio close with the cookie their button to remind later writes (V-162).
const dismissed = ['license-banner-dismissed', 'license-onboarding-dismissed', 'license-login-modal-dismissed'];

// The column and the row of the XYZ tile of a position, at a zoom.
const tileAt = (z: number, [longitude, latitude]: [number, number]) => {
	const scale = 2 ** z;
	const radians = (latitude * Math.PI) / 180;

	return {
		x: Math.floor(((longitude + 180) / 360) * scale),
		y: Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale),
	};
};

// The durations of the Server-Timing header, by name, in milliseconds.
const serverTimingOf = (header: string) => {
	const durations = Object.fromEntries(
		header
			.split(',')
			.map((entry) => /^\s*(\w+);dur=([\d.]+)/.exec(entry))
			.flatMap((match) => (match === null ? [] : [[match[1] ?? '', Number(match[2])]])),
	) as Record<string, number | undefined>;

	return { build: durations.build ?? Number.NaN, database: durations.db ?? Number.NaN };
};

// The features of a tile, each as text, in order, so two tiles with the same items and groups are equal.
const featuresOf = (body: Buffer) => {
	const layer = new VectorTile(new PbfReader(body)).layers.occurrences;

	if (layer === undefined) {
		return [];
	}

	return Array.from({ length: layer.length }, (_, index) => {
		const feature = layer.feature(index);

		return JSON.stringify({ id: feature.id, properties: feature.properties, geometry: feature.loadGeometry() });
	}).sort();
};

// What the plan says in a line: the time Postgres took, the nodes that read the table, and the pages of its buffers.
const summaryOfPlan = (plan: string) => ({
	execution: Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? Number.NaN),
	planning: Number(/Planning Time: ([\d.]+) ms/.exec(plan)?.[1] ?? Number.NaN),
	reads: [
		...new Set(
			[
				...plan.matchAll(
					/((?:Parallel )?(?:Seq Scan|Index Scan|Index Only Scan|Bitmap Index Scan|Bitmap Heap Scan))(?: using (\w+))? on (\w+)/g,
				),
			].map((match) => `${match[1] ?? ''}${match[2] === undefined ? '' : ` using ${match[2]}`} on ${match[3] ?? ''}`),
		),
	],
	buffers: /Buffers: (shared [^\n]+)/.exec(plan)?.[1] ?? '',
});

// Runs a query with psql inside the container of the database, whose database and user test/environment.ts names
// directus, and returns the rows as text.
const psql = async (database: StartedTestContainer, text: string): Promise<string> => {
	const { output, exitCode } = await database.exec([
		'psql',
		...['--username', 'directus', '--dbname', 'directus', '--tuples-only', '--no-align'],
		...['--set', 'ON_ERROR_STOP=1', '--command', text],
	]);

	if (exitCode !== 0) {
		throw new Error(`The query failed in the database container: ${output}`);
	}

	return output.trim();
};

// Stops the database with the time to shut down, and starts it again, with its buffers empty.
const restart = async (database: StartedTestContainer) => {
	await database.restart({ timeout: 60_000 });

	const deadline = Date.now() + 60_000;

	while (Date.now() < deadline) {
		const { exitCode } = await database.exec(['pg_isready', '--host', '127.0.0.1', '--username', 'directus']);

		if (exitCode === 0) {
			return;
		}

		await setTimeout(500);
	}

	throw new Error('The database did not come back within 60 s.');
};

// Each file of extensions, worker and tile the page downloaded, with the time from its request to the end of its body,
// the bytes that came through the network, and, for a tile, the times of its route.
const watchDownloads = (page: Page) => {
	const pending: Promise<Record<string, unknown> | undefined>[] = [];

	page.on('requestfinished', (request) => {
		const { pathname } = new URL(request.url());

		if (
			!/\/extensions\/sources\/|\/geospatial-spikes-layout\/maplibre-gl\/|\/geospatial-spikes\/tile\//.test(pathname)
		) {
			return;
		}

		pending.push(
			Promise.all([request.sizes(), request.response()]).then(async ([sizes, response]) => ({
				path: pathname,
				startedAt: Math.round(request.timing().startTime),
				milliseconds: Math.round(request.timing().responseEnd),
				bytes: sizes.responseBodySize,
				encoding: (await response?.headerValue('content-encoding')) ?? null,
				...(pathname.includes('/tile/') ? serverTimingOf((await response?.headerValue('server-timing')) ?? '') : {}),
			})),
		);
	});

	return async () => (await Promise.all(pending)).filter((download) => download !== undefined);
};

// What the machine of the measurements is, from inside the container of the database, which shares its kernel.
const machineOf = async (database: StartedTestContainer) => {
	const { output: processor } = await database.exec([
		'sh',
		'-c',
		"grep -m1 'model name' /proc/cpuinfo; nproc; grep MemTotal /proc/meminfo; uname -r",
	]);

	return { processor: processor.trim().split('\n'), postgres: await psql(database, 'select version()') };
};

// Random numbers with a seed, the mulberry32 generator, so the points of the API are the same on each run.
const generator = (seed: number) => {
	let state = seed;

	return () => {
		state = (state + 0x6d2b79f5) | 0;

		let value = Math.imul(state ^ (state >>> 15), 1 | state);

		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
};

// A point of the normal distribution around São Paulo, by the transform of Box and Muller.
const aroundSaoPaulo = (random: () => number): [number, number] => {
	const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

	return [center[0] + spread * normal(), center[1] + spread * normal()];
};

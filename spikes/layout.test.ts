import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createPreset, createUser, customEndpoint, readRoles, readUsers } from '@directus/sdk';
import geographiclib from 'geographiclib-geodesic';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { as, type Occurrence, versions } from '../test/directus.ts';
import { log, newSecret } from '../test/environment.ts';
import { startBrowser } from './browser.ts';
import { basemap, view } from './layout/src/view.ts';

// With SPIKE_LAYOUT_INLINE=1, the layout is built as the SDK builds it, with every dynamic import inlined, and the run
// only weighs the file of extensions the Studio downloads when it starts, for the comparison (F01-14).
const inline = process.env.SPIKE_LAYOUT_INLINE === '1';

// Strings only the code of each library has, which tell the chunk that carries it.
const markers = { maplibre: 'maplibregl-canvas', deck: 'deckgl-overlay', draw: 'Terra Draw is not enabled' };

// The only place outside Directus the page may reach: the basemap of OpenFreeMap, with its tiles, fonts and icons
// (D-011).
const openFreeMap = `${new URL(basemap).origin}/`;

// What a page of the Studio did, from the login on.
interface Session {
	page: Page;
	// The body of each file of extensions the page downloaded, by its path.
	sources: Map<string, Buffer>;
	// Every address the page and its workers asked for.
	requests: string[];
	// The workers the page started, by their address.
	workers: string[];
	// The complaints about the CSP in the console, and the errors no one caught.
	violations: string[];
	errors: string[];
	// The downloads still being read.
	pending: Promise<unknown>[];
}

const directusUrl = () => {
	const directus = inject('directus')[inject('combination')];

	if (directus === undefined) {
		throw new Error('The global setup did not start this combination.');
	}

	return directus.url;
};

const credentials = { email: 'browser@example.com', password: newSecret() };

// The Studio of a new project opens, for the admin, dialogs about the license, whose focus trap stops every click
// outside them (V-158). Each closes with a cookie of the browser, which its button to remind later writes, with no
// request to the server (F01-15), and the page starts with those cookies.
const dismissed = ['license-banner-dismissed', 'license-onboarding-dismissed', 'license-login-modal-dismissed'];

// A new page of the Studio, logged in with a session cookie, as the login form leaves it.
const openStudio = async (browser: Browser): Promise<Session> => {
	const context = await browser.newContext();

	await context.addCookies(dismissed.map((name) => ({ name, value: 'true', url: directusUrl() })));

	const page = await context.newPage();
	const session: Session = {
		page,
		sources: new Map(),
		requests: [],
		workers: [],
		violations: [],
		errors: [],
		pending: [],
	};

	page.on('request', (request) => session.requests.push(request.url()));
	page.on('response', (response) => {
		const { pathname } = new URL(response.url());

		// A body the page stops reading when it closes is not a file it downloaded.
		if (pathname.includes('/extensions/sources/')) {
			session.pending.push(
				response.body().then(
					(body) => session.sources.set(pathname, body),
					() => undefined,
				),
			);
		}
	});
	page.on('console', (message) => {
		if (/Content Security Policy|Refused to/i.test(message.text())) {
			session.violations.push(message.text());
		}
	});
	page.on('pageerror', (error) => session.errors.push(error.message));
	page.on('worker', (worker) => {
		session.workers.push(worker.url());
		worker.on('console', (message) => {
			if (/Content Security Policy|Refused to/i.test(message.text())) {
				session.violations.push(message.text());
			}
		});
	});

	const login = await context.request.post(`${directusUrl()}/auth/login`, {
		data: { ...credentials, mode: 'session' },
	});

	expect(login.ok()).toBe(true);

	return session;
};

// The files of extensions the page downloaded, once every body is read, and the ones with a library.
const settled = async (session: Session) => {
	await session.page.waitForLoadState('networkidle');
	await Promise.all(session.pending);

	const carrying = (marker: string) =>
		[...session.sources].filter(([, body]) => body.includes(marker)).map(([path]) => path);

	return { maplibre: carrying(markers.maplibre), deck: carrying(markers.deck), draw: carrying(markers.draw) };
};

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const weightOf = (body: Buffer) => `${kilobytes(body.length)}, ${kilobytes(gzipSync(body).length)} with gzip`;

// What the layout puts on its element for the proofs to read.
const stateOf = async (page: Page, name: string) =>
	(await page.locator('.geospatial-spike').getAttribute(`data-${name}`)) ?? '';

describe.runIf(versions().database.client === 'postgres')('o layout de prova, no Studio', () => {
	let browser: Browser;
	let stop: () => Promise<void>;

	beforeAll(async () => {
		({ browser, stop } = await startBrowser());

		const admin = as('admin');
		const [role] = await admin.request(readRoles({ fields: ['id'], filter: { name: { _eq: 'Administrator' } } }));

		if (role === undefined) {
			throw new Error('Directus has no role of administrator.');
		}

		await admin.request(createUser({ ...credentials, role: role.id }));
	}, 900_000);

	afterAll(async () => {
		await stop();
	});

	describe('o MapLibre só chega quando o layout abre (F01-14)', () => {
		it.runIf(inline)(
			'com o build do SDK, o arquivo inicial de extensões leva o MapLibre e o deck.gl',
			async () => {
				const session = await openStudio(browser);

				await session.page.goto(`${directusUrl()}/admin/content/occurrences`);

				const { maplibre, deck } = await settled(session);
				const initial = session.sources.get('/extensions/sources/index.js');

				expect(initial).toBeDefined();
				expect(maplibre).toEqual(['/extensions/sources/index.js']);
				expect(deck).toEqual(['/extensions/sources/index.js']);
				log(
					`${inject('combination')}: with the build of the SDK, the file of extensions weighs ${weightOf(initial ?? Buffer.alloc(0))}`,
				);
			},
			120_000,
		);

		describe.skipIf(inline)('com o build que mantém os imports dinâmicos', () => {
			let session: Session;

			it('abrir o Studio numa coleção, no layout de tabela, não baixa nenhum pedaço com o MapLibre', async () => {
				const table = await openStudio(browser);

				await table.page.goto(`${directusUrl()}/admin/content/occurrences`);
				await table.page.locator('table').first().waitFor();

				const { maplibre, deck, draw } = await settled(table);
				const initial = table.sources.get('/extensions/sources/index.js');

				expect(initial).toBeDefined();
				expect(maplibre).toEqual([]);
				expect(deck).toEqual([]);
				expect(draw).toEqual([]);
				log(
					`${inject('combination')}: with the dynamic imports kept, the file of extensions weighs ${weightOf(initial ?? Buffer.alloc(0))}`,
				);
			}, 120_000);

			it('abrir o layout de prova baixa o pedaço do MapLibre, de /extensions/sources/, e o mapa aparece', async () => {
				await as('admin').request(
					createPreset({ collection: 'occurrences', layout: 'geospatial-spike-map', user: await browserUser() }),
				);
				session = await openStudio(browser);
				await session.page.goto(`${directusUrl()}/admin/content/occurrences`);
				await session.page.locator('[data-map="loaded"]').waitFor({ timeout: 60_000 });

				const { maplibre, deck, draw } = await settled(session);
				const canvas = await session.page.locator('.maplibregl-canvas').boundingBox();

				expect(maplibre).toHaveLength(1);
				expect(maplibre[0]).toMatch(/^\/extensions\/sources\/.+\.js$/);
				expect(deck).toEqual([]);
				expect(draw).toEqual([]);
				// The worker of MapLibre comes from the route of the bundle, in the version of its MapLibre.
				expect(session.workers).toContainEqual(
					expect.stringMatching(/\/geospatial-spikes-layout\/maplibre-gl\/\d+\.\d+\.\d+\/maplibre-gl-worker\.mjs$/),
				);
				expect(canvas?.width).toBeGreaterThan(0);
				expect(canvas?.height).toBeGreaterThan(0);

				for (const path of maplibre) {
					log(
						`${inject('combination')}: the chunk of MapLibre, ${path}, weighs ${weightOf(session.sources.get(path) ?? Buffer.alloc(0))}`,
					);
				}
			}, 120_000);

			it('o pedaço do deck.gl só chega quando a camada do deck.gl é ligada, e o worker do loaders.gl vem da extensão', async () => {
				await session.page.locator('.geospatial-spike-deck').click();
				await session.page.locator('[data-deck="loaded"]').waitFor({ timeout: 60_000 });

				const { deck, draw } = await settled(session);

				expect(deck).toHaveLength(1);
				expect(draw).toEqual([]);
				expect(session.workers.some((url) => url.startsWith('blob:'))).toBe(true);
				expect(session.requests.some((url) => url.includes('/geospatial-spikes/tile/occurrences/'))).toBe(true);

				for (const path of deck) {
					log(
						`${inject('combination')}: the chunk of deck.gl, ${path}, weighs ${weightOf(session.sources.get(path) ?? Buffer.alloc(0))}`,
					);
				}
			}, 120_000);

			it('nenhum pedido sai do Directus, fora o mapa de fundo do OpenFreeMap, e o console não mostra violação da CSP nem erro', () => {
				expectNothingElsewhere(session);
				log(`${inject('combination')}: the workers of the page were ${session.workers.join(', ')}`);
			});
		});
	});

	describe.skipIf(inline)('MapLibre, deck.gl e Terra Draw no mesmo mapa (F01-15)', () => {
		let session: Session;
		let screen: Screen;

		beforeAll(async () => {
			session = await openStudio(browser);
			await session.page.goto(`${directusUrl()}/admin/content/occurrences`);
			await session.page.locator('[data-map="loaded"]').waitFor({ timeout: 60_000 });
			screen = await screenOf(session.page);
		}, 120_000);

		it('a camada do deck.gl fica acima do mapa de fundo e abaixo dos nomes de ruas, num canvas só', async () => {
			await session.page.locator('.geospatial-spike-deck').click();
			await session.page.locator('[data-deck="loaded"]').waitFor({ timeout: 60_000 });

			const layers = JSON.parse(await stateOf(session.page, 'layers')) as { id: string; type?: string }[];
			const custom = layers.findIndex(({ type }) => type === 'custom');
			const below = layers.slice(0, custom);
			const above = layers.slice(custom + 1);

			// deck.gl draws its layers in one custom layer of MapLibre, in the WebGL of the same canvas.
			expect(layers.filter(({ type }) => type === 'custom')).toHaveLength(1);
			expect(below.map(({ id }) => id)).toContain('highway_minor');
			expect(below.filter(({ type }) => type === 'symbol')).toEqual([]);
			expect(above.filter(({ type }) => type !== 'symbol')).toEqual([]);
			expect(above.map(({ id }) => id)).toEqual(
				expect.arrayContaining(['highway-name-path', 'highway-name-minor', 'highway-name-major']),
			);
			const canvases = await session.page.locator('.geospatial-spike-map canvas').count();

			expect(canvases).toBe(1);
			await screenshot(session.page, 'deck');
			log(
				`${inject('combination')}: deck.gl draws between ${below.at(-1)?.id ?? ''} and ${above[0]?.id ?? ''}, in ${String(canvases)} canvas`,
			);
		}, 120_000);

		it('o círculo geodésico desenhado tem o raio pedido em metros, conferido pela GeographicLib', async () => {
			await session.page.locator('.geospatial-spike-circle').click();
			await session.page.locator('[data-draw="loaded"]').waitFor({ timeout: 60_000 });

			const { draw } = await settled(session);

			expect(draw).toHaveLength(1);

			for (const path of draw) {
				log(
					`${inject('combination')}: the chunk of Terra Draw, ${path}, weighs ${weightOf(session.sources.get(path) ?? Buffer.alloc(0))}`,
				);
			}

			// A radius of 300 m to the east of the first occurrence of the south zone, clicked on the pixels nearest to it.
			const asked = 300;
			const center: Position = [-46.7, -23.65];
			const { lat2, lon2 } = wgs84.Direct(center[1], center[0], 90, asked);

			if (lat2 === undefined || lon2 === undefined) {
				throw new Error('GeographicLib did not return the point.');
			}

			const from = screen.pixelOf(center);
			const to = screen.pixelOf([lon2, lat2]);

			await session.page.mouse.click(from.x, from.y);
			await session.page.mouse.move(to.x, to.y, { steps: 10 });
			await session.page.mouse.click(to.x, to.y);

			const circle = await drawnShape(session.page, 'circle');
			const clicked = { center: screen.positionOf(from), edge: screen.positionOf(to) };
			// The radius the two clicks asked for, on the ellipsoid, which is the one of 300 m to within a pixel.
			const radius = distance(clicked.center, clicked.edge);
			const ring = circle.geometry.coordinates[0] ?? [];
			const errors = ring.map((vertex) => (distance(clicked.center, vertex) - radius) / radius);
			const worst = Math.max(...errors.map(Math.abs));

			expect(Math.abs(radius - asked)).toBeLessThan(screen.metersPerPixel);
			expect(ring.length).toBeGreaterThan(32);
			expect(ring[0]).toEqual(ring.at(-1));
			// Terra Draw measures the radius and places the vertices on a sphere of 6371 km, and the Earth curves less from
			// north to south than from west to east. At the latitude of São Paulo, a vertex to the north lies 0.56% short of
			// the radius on the ellipsoid, which is the tolerance, rounded up.
			expect(worst).toBeLessThan(0.006);
			log(
				`${inject('combination')}: the circle asked for ${radius.toFixed(2)} m on the ellipsoid, Terra Draw kept ${(Number(circle.properties.radiusKilometers) * 1000).toFixed(2)} m, and its ${String(ring.length - 1)} vertices lie from ${(Math.min(...errors) * 100).toFixed(3)}% to ${(Math.max(...errors) * 100).toFixed(3)}% of it`,
			);
		}, 120_000);

		it('o polígono desenhado volta como GeoJSON válido, com os vértices clicados', async () => {
			await session.page.locator('.geospatial-spike-polygon').click();

			// A square around the second occurrence of the south zone, clicked clockwise, and closed on its first vertex.
			const inside: Position = [-46.69, -23.66];
			const middle = screen.pixelOf(inside);
			const corners = [
				[-60, -60],
				[60, -60],
				[60, 60],
				[-60, 60],
			].map(([dx = 0, dy = 0]) => ({ x: middle.x + dx, y: middle.y + dy }));

			for (const corner of [...corners, corners[0] ?? middle]) {
				await session.page.mouse.move(corner.x, corner.y, { steps: 5 });
				await session.page.mouse.click(corner.x, corner.y);
			}

			const polygon = await drawnShape(session.page, 'polygon');
			const [ring = [], ...holes] = polygon.geometry.coordinates;
			const clicked = corners.map((corner) => screen.positionOf(corner));

			// RFC 7946: a closed ring of four positions or more, counterclockwise outside, and no edge crossing another.
			expect(polygon.geometry.type).toBe('Polygon');
			expect(holes).toEqual([]);
			expect(ring).toHaveLength(clicked.length + 1);
			expect(ring[0]).toEqual(ring.at(-1));
			expect(signedArea(ring)).toBeGreaterThan(0);
			expect(crossings(ring)).toBe(0);

			// Terra Draw turned the clockwise clicks into a counterclockwise ring, with the same vertices.
			for (const position of clicked) {
				expect(ring.some((vertex) => near(vertex, position))).toBe(true);
			}

			// Directus reads it as a filter, and the occurrence inside is the only one it lets through. The schema of the
			// suite types the operand as the point of the field, so the filter goes by the path of /items.
			const items = await as('admin').request(
				customEndpoint<Pick<Occurrence, 'geometry'>[]>({
					path: '/items/occurrences',
					method: 'GET',
					params: { fields: ['geometry'], filter: { geometry: { _intersects: polygon.geometry } }, limit: -1 },
				}),
			);

			expect(items.map(({ geometry }) => geometry.coordinates)).toEqual([inside]);
			log(`${inject('combination')}: the polygon came back as ${JSON.stringify(polygon.geometry)}`);
		}, 120_000);

		it('as capturas de tela do mapa, para o mantenedor conferir, sem pedido fora do OpenFreeMap nem erro', async () => {
			await screenshot(session.page, 'drawn');
			expectNothingElsewhere(session);
		}, 120_000);
	});
});

// A screenshot of the map, for the maintainer to look at, in test-results/f01-15, which Git leaves out.
const screenshot = async (page: Page, name: string) => {
	const folder = fileURLToPath(new URL('../test-results/f01-15/', import.meta.url));
	const path = `${folder}${inject('combination')}-${name}.png`;

	await mkdir(folder, { recursive: true });
	await page.locator('.geospatial-spike-map').screenshot({ path });
	log(`${inject('combination')}: the screenshot of the map is at ${path}`);
};

// No request leaves Directus but the ones to the basemap, and the console shows no complaint about the CSP and no error.
const expectNothingElsewhere = (session: Session) => {
	const { origin } = new URL(directusUrl());
	const elsewhere = session.requests.filter(
		(url) => !url.startsWith(`${origin}/`) && !url.startsWith(openFreeMap) && !/^(blob|data):/.test(url),
	);

	expect(elsewhere).toEqual([]);
	expect(session.violations).toEqual([]);
	expect(session.errors).toEqual([]);
};

// The id of the user the browser logs in as.
const browserUser = async () => {
	const [user] = await as('admin').request(
		readUsers({ fields: ['id'], filter: { email: { _eq: credentials.email } } }),
	);

	if (user === undefined) {
		throw new Error('The user of the browser does not exist.');
	}

	return user.id;
};

type Position = [number, number];

const wgs84 = geographiclib.Geodesic.WGS84;

// The distance on the ellipsoid, in meters, as PostGIS measures a geography (V-42).
const distance = (from: Position, to: Position) => wgs84.Inverse(from[1], from[0], to[1], to[0]).s12 ?? Number.NaN;

// The place of a position on the page, and back, by the Web Mercator of MapLibre, which draws the world 512 pixels wide
// at zoom 0 and the center of the view at the center of its container, measured by the size MapLibre reads.
interface Screen {
	pixelOf: (position: Position) => { x: number; y: number };
	positionOf: (pixel: { x: number; y: number }) => Position;
	metersPerPixel: number;
}

const screenOf = async (page: Page): Promise<Screen> => {
	const box = await page.locator('.geospatial-spike-map').evaluate((element) => {
		const { left, top } = element.getBoundingClientRect();

		return { left, top, width: element.clientWidth, height: element.clientHeight };
	});
	const size = 512 * 2 ** view.zoom;
	const toWorld = ([longitude, latitude]: Position) => ({
		x: ((longitude + 180) / 360) * size,
		y: ((1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2) * size,
	});
	const middle = toWorld(view.center);
	const origin = { x: box.left + box.width / 2 - middle.x, y: box.top + box.height / 2 - middle.y };

	return {
		// The mouse clicks on whole pixels, the ones nearest to the position.
		pixelOf: (position) => {
			const world = toWorld(position);

			return { x: Math.round(origin.x + world.x), y: Math.round(origin.y + world.y) };
		},
		positionOf: ({ x, y }) => [
			((x - origin.x) / size) * 360 - 180,
			(Math.atan(Math.exp(Math.PI * (1 - (2 * (y - origin.y)) / size))) * 360) / Math.PI - 90,
		],
		metersPerPixel: (40_075_016.686 * Math.cos((view.center[1] * Math.PI) / 180)) / size,
	};
};

// The shape Terra Draw kept last in a mode, once the layout has it.
const drawnShape = async (page: Page, mode: string) => {
	await page.waitForFunction(
		(wanted) => {
			const drawn = document.querySelector('.geospatial-spike')?.getAttribute('data-drawn') ?? '[]';

			return (JSON.parse(drawn) as { properties: { mode?: string } }[]).some(
				({ properties }) => properties.mode === wanted,
			);
		},
		mode,
		{ timeout: 30_000 },
	);

	const shapes = JSON.parse(await stateOf(page, 'drawn')) as {
		geometry: { type: string; coordinates: Position[][] };
		properties: Record<string, unknown>;
	}[];
	const shape = shapes.findLast(({ properties }) => properties.mode === mode);

	if (shape === undefined) {
		throw new Error(`Terra Draw kept no shape in the mode ${mode}.`);
	}

	return shape;
};

// Twice the area of a ring in degrees, positive when it runs counterclockwise.
const signedArea = (ring: Position[]) =>
	ring.slice(1).reduce((sum, [x, y], index) => {
		const [previousX = 0, previousY = 0] = ring[index] ?? [];

		return sum + (previousX * y - x * previousY);
	}, 0);

// How many pairs of edges of a ring cross, leaving out the ones that share a vertex.
const crossings = (ring: Position[]) => {
	const side = (a: Position, b: Position, c: Position) =>
		Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
	const edges = ring.slice(1).map((end, index) => [ring[index] ?? end, end] as const);
	let count = 0;

	for (const [index, [a, b]] of edges.entries()) {
		// The next edge shares a vertex with this one, and so does the last with the first.
		for (const [c, d] of edges.slice(index + 2, index === 0 ? -1 : undefined)) {
			if (side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)) {
				count += 1;
			}
		}
	}

	return count;
};

// A vertex Terra Draw kept at the position clicked, to a millimeter or so: it keeps 9 decimals.
const near = (vertex: Position, position: Position) =>
	Math.abs(vertex[0] - position[0]) < 1e-8 && Math.abs(vertex[1] - position[1]) < 1e-8;

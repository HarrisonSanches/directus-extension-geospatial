import { gzipSync } from 'node:zlib';
import { createPreset, createUser, readRoles, readUsers } from '@directus/sdk';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { as, versions } from '../test/directus.ts';
import { log, newSecret } from '../test/environment.ts';
import { startBrowser } from './browser.ts';

// With SPIKE_LAYOUT_INLINE=1, the layout is built as the SDK builds it, with every dynamic import inlined, and the run
// only weighs the file of extensions the Studio downloads when it starts, for the comparison (F01-14).
const inline = process.env.SPIKE_LAYOUT_INLINE === '1';

// Strings only the code of each library has, which tell the chunk that carries it.
const markers = { maplibre: 'maplibregl-canvas', deck: 'deckgl-overlay' };

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

// A new page of the Studio, logged in with a session cookie, as the login form leaves it.
const openStudio = async (browser: Browser): Promise<Session> => {
	const context = await browser.newContext();
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

	return { maplibre: carrying(markers.maplibre), deck: carrying(markers.deck) };
};

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const weightOf = (body: Buffer) => `${kilobytes(body.length)}, ${kilobytes(gzipSync(body).length)} with gzip`;

describe.runIf(versions().database.client === 'postgres')('o MapLibre só chega quando o layout abre (F01-14)', () => {
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

			const { maplibre, deck } = await settled(table);
			const initial = table.sources.get('/extensions/sources/index.js');

			expect(initial).toBeDefined();
			expect(maplibre).toEqual([]);
			expect(deck).toEqual([]);
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

			const { maplibre, deck } = await settled(session);
			const canvas = await session.page.locator('.maplibregl-canvas').boundingBox();

			expect(maplibre).toHaveLength(1);
			expect(maplibre[0]).toMatch(/^\/extensions\/sources\/.+\.js$/);
			expect(deck).toEqual([]);
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
			// The Studio of a new project asks, in a dialog over the page, for the owner of the project and the terms of its
			// license, which the proof leaves unanswered: answering sends them to Directus. The focus trap of the dialog stops
			// every click outside it, so the proof turns the layer on by the event of its own that the layout listens to.
			await session.page.locator('.geospatial-spike').dispatchEvent('geospatial-spike-deck');
			await session.page.locator('[data-deck="loaded"]').waitFor({ timeout: 60_000 });

			const { deck } = await settled(session);

			expect(deck).toHaveLength(1);
			expect(session.workers.some((url) => url.startsWith('blob:'))).toBe(true);
			expect(session.requests.some((url) => url.includes('/geospatial-spikes/tile/occurrences/'))).toBe(true);

			for (const path of deck) {
				log(
					`${inject('combination')}: the chunk of deck.gl, ${path}, weighs ${weightOf(session.sources.get(path) ?? Buffer.alloc(0))}`,
				);
			}
		}, 120_000);

		it('nenhum pedido sai para uma CDN, e o console não mostra violação da CSP', () => {
			const { origin } = new URL(directusUrl());
			const elsewhere = session.requests.filter((url) => !url.startsWith(`${origin}/`) && !/^(blob|data):/.test(url));

			expect(elsewhere).toEqual([]);
			expect(session.violations).toEqual([]);
			log(`${inject('combination')}: the workers of the page were ${session.workers.join(', ')}`);

			// deck.gl 9.4 reads map.transform, which the Map of MapLibre 6 no longer has, and throws on each frame it draws in
			// the canvas of MapLibre. That is the question of F01-15 (V-159), and any other error fails the proof.
			const drawing = session.errors.filter((error) => error.includes("reading 'height'"));

			expect(session.errors.filter((error) => !drawing.includes(error))).toEqual([]);
			log(`${inject('combination')}: deck.gl threw ${String(drawing.length)} times drawing on MapLibre 6`);
		});
	});
});

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

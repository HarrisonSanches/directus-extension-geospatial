import { realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright-core';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

// The official image of Playwright, with its browsers and what they need from the system, in the version of the
// playwright-core of the catalog, which must be the same on both ends. Pinned by the digest of its tag.
const image =
	'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e';

// A free port of the host, for the server in the container, which shares the network of the host.
const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const server = createServer();

		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			server.close(() => {
				if (address === null || typeof address === 'string') {
					reject(new Error('The host gave no free port.'));
				} else {
					resolve(address.port);
				}
			});
		});
	});

// A browser in the container of Playwright, driven from the tests on the host (F01-14). The container shares the
// network of the host, so the browser reaches Directus at the same address the tests do. The image has no Playwright
// package, and the server runs from the playwright-core the tests have, the same version as its browsers. Without a
// graphics card, Chromium draws WebGL on the processor, through SwiftShader, which Playwright turns on by default.
export const startBrowser = async (): Promise<{ browser: Browser; stop: () => Promise<void> }> => {
	const core = await realpath(fileURLToPath(new URL('.', import.meta.resolve('playwright-core/package.json'))));
	const port = await freePort();
	const container: StartedTestContainer = await new GenericContainer(image)
		.withNetworkMode('host')
		.withSharedMemorySize(1024 ** 3)
		.withBindMounts([{ source: core, target: '/playwright-core', mode: 'ro' }])
		.withUser('pwuser')
		.withCommand(['node', '/playwright-core/cli.js', 'run-server', '--port', String(port), '--host', '127.0.0.1'])
		.withWaitStrategy(Wait.forLogMessage(/Listening on/))
		.withStartupTimeout(600_000)
		.start();
	const browser = await chromium.connect(`ws://127.0.0.1:${String(port)}/`);

	return {
		browser,
		stop: async () => {
			await browser.close();
			await container.stop();
		},
	};
};

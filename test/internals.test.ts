import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { customEndpoint } from '@directus/sdk';
import { GenericContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { connect } from './directus.ts';
import { type Environment, startEnvironment } from './environment.ts';
import type { Capabilities } from 'directus-geospatial-contract';

const combination = inject('combination');

const context = fileURLToPath(new URL('moved-module/', import.meta.url));

// Builds the image of test/moved-module/ on an official image of Directus. The image stays in Docker after the run, so
// the next runs take it from the cache of the build.
const directusWithMovedModule = async ({ version, image }: { version: string; image: string }) => {
	const tag = `directus-extension-geospatial-test/directus-moved-module:${version}`;

	await GenericContainer.fromDockerfile(context).withBuildArgs({ DIRECTUS: image }).build(tag, { deleteOnExit: false });

	return { version: `${version}-moved-module`, image: tag };
};

const missing = '@directus/api/database/run-ast/lib/get-db-query could not be imported (ERR_MODULE_NOT_FOUND)';

// The rehearsal of protection 2 (§5) needs a Directus of its own, so the other tests of the combination keep theirs.
// Once with each Directus version, on PostGIS.
describe.runIf(combinations[combination].database.client === 'postgres')(
	'um Directus sem o módulo da cadeia no caminho que os adaptadores importam',
	() => {
		let environment: Environment | undefined;
		let stream: Readable | undefined;
		let logs = '';

		const started = () => {
			if (environment === undefined) {
				throw new Error('The Directus of the test did not start.');
			}

			return environment;
		};

		beforeAll(async () => {
			const directus = await directusWithMovedModule(combinations[combination].directus);

			environment = await startEnvironment(combination, inject('coverage'), {
				name: `${combination}-moved-module`,
				directus,
			});

			// The log of Directus since it started, as Docker keeps it.
			stream = await environment.directus.logs();
			stream.on('data', (chunk: Buffer) => {
				logs += chunk.toString();
			});
		}, 300_000);

		afterAll(async () => {
			stream?.destroy();
			await environment?.stop();
		}, 120_000);

		it('sobe, e o capabilities do admin mostra os internos recusados, com o que falta', async () => {
			const { url, admin } = started();
			const { internals } = await connect(url, admin.token).request(
				customEndpoint<Capabilities>({ path: '/geospatial/capabilities', method: 'GET' }),
			);

			expect(internals?.status).toBe('refused');

			// Each adapter, the one of the version included, misses the module.
			const problems = internals?.status === 'refused' ? internals.problems : {};

			expect(Object.keys(problems).sort()).toEqual(['11.17', '12']);
			expect(Object.values(problems)).toEqual([expect.arrayContaining([missing]), expect.arrayContaining([missing])]);
		});

		it('o log avisa, com o que falta', async () => {
			await expect
				.poll(() => logs, { timeout: 30_000 })
				.toMatch(/WARN.*No adapter of the extension takes the internals of this Directus/);
			expect(logs).toContain(missing);
		});
	},
);

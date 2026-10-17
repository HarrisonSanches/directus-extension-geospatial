import { login } from '@directus/sdk';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from './combinations.ts';
import { bringBack as bringBackContainer, takeDown } from './containers.ts';
import { checkedFetch } from './contract.ts';
import { connect } from './directus.ts';
import { type Environment, startEnvironment } from './environment.ts';

const combination = inject('combination');

// pm2 runs Directus with the automatic restart off, as its image comes, so the same process with no restarts means
// Directus never went down (V-124).
const processOf = async (directus: StartedTestContainer) => {
	const { stdout, output, exitCode } = await directus.exec(['pm2', 'jlist']);

	if (exitCode !== 0) {
		throw new Error(`pm2 could not list the processes of Directus: ${output}`);
	}

	return (JSON.parse(stdout) as { pid: number; pm2_env: { restart_time: number } }[]).map(
		({ pid, pm2_env: { restart_time: restarts } }) => ({ pid, restarts }),
	);
};

const bringBack = (database: StartedTestContainer) =>
	bringBackContainer(database, ['pg_isready', '--host', '127.0.0.1', '--username', 'directus']);

// Only a database that runs in a container of its own can go down while Directus stays up. The test starts its own,
// so the other tests of the combination keep theirs.
describe.runIf(combinations[combination].database.client === 'postgres')('o capabilities com o banco fora', () => {
	let environment: Environment | undefined;
	let session = '';

	const started = () => {
		const database = environment?.backend.database;

		if (environment === undefined || database === undefined) {
			throw new Error('The Directus of the test did not start.');
		}

		return { ...environment, database };
	};

	// Each answer, the 503 included, goes through the contract (test/contract.ts).
	const capabilities = () =>
		checkedFetch(`${started().url}/geospatial/capabilities`, { headers: { Authorization: `Bearer ${session}` } });

	beforeAll(async () => {
		environment = await startEnvironment(combination, inject('coverage'), { name: `${combination}-database-down` });

		// Directus looks a static token up in the database before any route, so with the database down it answers with
		// an error of its own (V-124). A session token only needs the roles and the access Directus keeps in memory,
		// which the first request loads.
		const { email, password } = environment.admin;
		const { access_token: accessToken } = await connect(environment.url, null).request(login({ email, password }));

		session = accessToken ?? '';
		expect((await capabilities()).status).toBe(200);
	}, 240_000);

	afterAll(() => environment?.stop(), 120_000);

	it('responde com o erro próprio, sem a causa, e o Directus continua de pé', { timeout: 90_000 }, async () => {
		const { directus, database, url } = started();
		const before = await processOf(directus);

		await takeDown(database);

		try {
			const response = await capabilities();

			expect(response.status).toBe(503);
			// The whole body: the admin, who sees the message of an unknown error, gets no SQL, host or driver detail.
			expect(await response.json()).toEqual({
				errors: [
					{
						message: 'The database did not answer. Try again later.',
						extensions: { code: 'GEOSPATIAL_DATABASE_UNAVAILABLE' },
					},
				],
			});
			expect(await (await fetch(`${url}/server/ping`)).text()).toBe('pong');
			expect(await processOf(directus)).toEqual(before);
		} finally {
			await bringBack(database);
		}
	});

	it('quando o banco volta, a rota volta a responder, sem reiniciar o Directus', { timeout: 90_000 }, async () => {
		const { directus, database } = started();
		const before = await processOf(directus);

		await takeDown(database);
		expect((await capabilities()).status).toBe(503);

		await bringBack(database);

		await expect.poll(async () => (await capabilities()).status, { timeout: 30_000, interval: 500 }).toBe(200);
		expect(await processOf(directus)).toEqual(before);
	});
});

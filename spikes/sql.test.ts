import { createField, createPolicy, createRole, createUser, customEndpoint } from '@directus/sdk';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { combinations } from '../test/combinations.ts';
import { type Client, connect, hasCustomPermissionRules } from '../test/directus.ts';
import { type Environment, extension, log, newSecret, startEnvironment, urlOf } from '../test/environment.ts';
import { readLicenseKey } from '../test/license.ts';
import { seed } from '../test/seed.ts';

// What the radius route of the spike answers about the permitted query (spikes/extension/src/radius.ts).
interface Radius {
	permitted: { sql: string; bindings: unknown[] };
	usesNow: boolean;
}

const combination = inject('combination');
const images = combinations[combination];

// Directus 12 needs the key for the row rules, and the database of this test starts on the Core tier (D-043).
const tiered = Number(images.directus.version.split('.')[0]) >= 12;

// The same request each time: the fields, the filter and the search of a page, around a point.
const page = { fields: ['*'], filter: { status: { _eq: 'open' } }, search: 'theft' };

const radius = (client: Client) =>
	client.request(
		customEndpoint<Radius>({
			path: '/geospatial-spikes/radius/occurrences',
			method: 'GET',
			params: { longitude: -46.7, latitude: -23.65, meters: 10_000, ...page },
		}),
	);

const permittedOf = async (client: Client) => (await radius(client)).permitted;

// A role whose one policy reads the occurrences by a rule, and users of it, each with a static token.
const usersWith = async (admin: Client, name: string, rule: Record<string, unknown>, count = 1) => {
	const role = await admin.request(createRole({ name }));

	await admin.request(
		createPolicy({
			name,
			admin_access: false,
			app_access: false,
			permissions: [{ collection: 'occurrences', action: 'read', fields: ['*'], permissions: rule }],
			roles: [{ role: role.id }],
		}),
	);

	return Promise.all(
		Array.from({ length: count }, async (_, index) => {
			const token = newSecret();
			const email = `${name.toLowerCase().replaceAll(/\W+/g, '-')}-${String(index + 1)}@example.com`;
			const { id } = await admin.request(createUser({ email, password: newSecret(), role: role.id, token }));

			return { id, token };
		}),
	);
};

// The restart and the second Directus would disturb the other spikes of the combination, and the requests here would
// reach the hook of F01-04, so this file runs on a Directus of its own, with its own database.
describe.runIf(images.database.client === 'postgres' && hasCustomPermissionRules())(
	'o mesmo pedido gera o mesmo SQL, a base do cache (F01-05)',
	() => {
		let environment: Environment | undefined;
		let tokens = { maria: '', joao: '', past: '' };
		let own: { id: string; token: string }[] = [];

		const started = () => {
			if (environment === undefined) {
				throw new Error('The Directus of the test did not start.');
			}

			return environment;
		};

		// The Directus the test calls, by its port now, which changes when it restarts.
		const as = (token: string, directus: StartedTestContainer = started().directus) => connect(urlOf(directus), token);

		// A Directus 12 that restarts or starts on the database reads the activation from it, without the key. A new
		// project would be a new activation of the key, and the spike stops there (D-044).
		const expectProjectOfTests = async () => {
			const { hasProjectOfTests } = started().backend;

			if (tiered && hasProjectOfTests !== undefined && !(await hasProjectOfTests())) {
				throw new Error('The database of Directus 12 lost the project of the tests. See D-044 before any rerun.');
			}
		};

		beforeAll(async () => {
			environment = await startEnvironment(combination, inject('coverage'), `${combination}-sql`, [
				extension,
				...inject('extensions'),
			]);

			const admin = connect(environment.url, environment.admin.token);
			const { activate } = environment.backend;

			if (tiered) {
				const key = await readLicenseKey();

				if (key === undefined || activate === undefined) {
					throw new Error('Directus 12 needs the key of the tests for the row rules of Maria.');
				}

				await activate(admin, key);
				log(`${combination}-sql: activated the key on the project of the tests`);
			}

			const { maria } = await seed(admin, newSecret, true);

			// Whoever reported the occurrence, for a rule with $CURRENT_USER.
			await admin.request(createField('occurrences', { field: 'reported_by', type: 'uuid', schema: {} }));

			const [joao] = await usersWith(admin, 'João, North Zone Operator', { region: { _eq: 'north' } });
			const [past] = await usersWith(admin, 'Past occurrences', { occurred_at: { _lte: '$NOW' } });

			own = await usersWith(admin, 'Own reports', { reported_by: { _eq: '$CURRENT_USER' } }, 2);
			tokens = { maria, joao: joao?.token ?? '', past: past?.token ?? '' };
		}, 240_000);

		afterAll(() => environment?.stop(), 120_000);

		it('o mesmo pedido da Maria gera o mesmo SQL e os mesmos valores em chamadas seguidas', async () => {
			const first = await permittedOf(as(tokens.maria));

			for (let request = 0; request < 10; request++) {
				expect(await permittedOf(as(tokens.maria))).toEqual(first);
			}

			log(
				`${combination}: the permitted query of Maria compiles to ${first.sql} with ${JSON.stringify(first.bindings)}`,
			);
		});

		it('a Maria e o João geram o mesmo texto de SQL, com o valor da regra de cada um (D-006)', async () => {
			const maria = await permittedOf(as(tokens.maria));
			const joao = await permittedOf(as(tokens.joao));

			expect(joao.sql).toBe(maria.sql);
			expect(maria.bindings).toContain('south');
			expect(joao.bindings).toContain('north');
			expect(joao.bindings).not.toContain('south');
		});

		it('com o $CURRENT_USER na regra, o id de cada usuário vai nos valores (D-006)', async () => {
			const [first, second] = own;

			if (first === undefined || second === undefined) {
				throw new Error('The role with $CURRENT_USER has no users.');
			}

			const mine = await permittedOf(as(first.token));
			const theirs = await permittedOf(as(second.token));

			expect(theirs.sql).toBe(mine.sql);
			expect(mine.bindings).toContain(first.id);
			expect(mine.bindings).not.toContain(second.id);
			expect(theirs.bindings).toContain(second.id);
		});

		it('com o $NOW na regra, dois pedidos seguidos geram valores diferentes, e a regra crua mostra o caso', async () => {
			const first = await radius(as(tokens.past));
			const second = await radius(as(tokens.past));

			expect(second.permitted.sql).toBe(first.permitted.sql);
			expect(second.permitted.bindings).not.toEqual(first.permitted.bindings);
			log(
				`${combination}: with $NOW in the rule, two requests in a row got ${JSON.stringify(first.permitted.bindings)} and ${JSON.stringify(second.permitted.bindings)}`,
			);

			// The key of the cache recognizes the case by the rules as the policies store them.
			expect(first.usesNow).toBe(true);
			expect((await radius(as(tokens.maria))).usesNow).toBe(false);
		});

		it('depois de reiniciar o Directus, o mesmo pedido da Maria gera o mesmo SQL', { timeout: 120_000 }, async () => {
			const before = await permittedOf(as(tokens.maria));

			await started().directus.restart();
			await expectProjectOfTests();

			expect(await permittedOf(as(tokens.maria))).toEqual(before);
		});

		it(
			'em duas instâncias sobre o mesmo banco, o mesmo pedido da Maria gera o mesmo SQL',
			{ timeout: 240_000 },
			async () => {
				const other = await started().another();

				await expectProjectOfTests();

				const [here, there] = await Promise.all([permittedOf(as(tokens.maria)), permittedOf(as(tokens.maria, other))]);

				expect(there).toEqual(here);
			},
		);
	},
);

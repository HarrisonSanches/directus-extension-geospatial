import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { customEndpoint, isDirectusError } from '@directus/sdk';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from './directus.ts';
import { query } from './postgres.ts';

// The project and the public URL the activation of the tests binds to (D-044). Directus 12 sends both to the licensing
// server with the key, so every run, on any machine and in the CI, reuses one activation. The server picked the project
// on the first activation, through test/bind-license.ts, on 26/09/2026. Neither is a secret: every call to the licensing
// server also needs the key.
const project = '01a0dc13-4469-756f-944f-8602934a349f';
export const publicUrl = 'http://integration-tests.localhost';

const isMissingFile = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

const nonEmpty = (value: string | undefined) => {
	const trimmed = value?.trim();

	return trimmed === '' ? undefined : trimmed;
};

// The key of the Open Innovation Grant (D-043): DIRECTUS_LICENSE_KEY from the environment, as the CI sets it from its
// secret, or from test/.env, which stays out of Git. Set to empty in the environment, or missing from both, it leaves
// Directus 12 on the Core tier.
export const readLicenseKey = async (): Promise<string | undefined> => {
	if (process.env.DIRECTUS_LICENSE_KEY !== undefined) {
		return nonEmpty(process.env.DIRECTUS_LICENSE_KEY);
	}

	const file = await readFile(new URL('.env', import.meta.url), 'utf8').catch((error: unknown) => {
		if (isMissingFile(error)) {
			return '';
		}

		throw error;
	});

	return nonEmpty(parseEnv(file).DIRECTUS_LICENSE_KEY);
};

const projectOf = (database: StartedPostgreSqlContainer) => query(database, 'select project_id from directus_settings');

// What Directus answered, without the key, in case an answer ever repeats it.
const reasonOf = (error: unknown, key: string) => {
	let reason = String(error);

	if (isDirectusError(error)) {
		reason = error.errors.map(({ message }) => message).join('; ');
	} else if (error instanceof Error) {
		reason = error.message;
	}

	return reason.replaceAll(key, '<license key>');
};

// Sends the key in the body of the request, as the Studio does, and never through the environment of the container.
const postLicense = async (admin: Client, key: string) => {
	try {
		await admin.request(
			customEndpoint({ path: '/license', method: 'POST', body: JSON.stringify({ license_key: key }) }),
		);
	} catch (error) {
		throw new Error(`Directus 12 could not activate the key: ${reasonOf(error, key)}`, { cause: error });
	}
};

// Applies the key to a Directus 12 that runs on the Core tier, under the project Directus created, and returns the
// project the licensing server bound it to. The server does not take a project it does not know, and answers with one
// of its own (V-119), so the project of the tests comes from here, once: test/bind-license.ts calls it, and its result
// goes into the constant above.
export const bindLicense = async (
	admin: Client,
	database: StartedPostgreSqlContainer,
	key: string,
): Promise<string> => {
	await postLicense(admin, key);

	return projectOf(database);
};

// Applies the key to a Directus 12 that runs on the Core tier, under the project of the tests, which reuses their
// activation (D-044).
export const activateLicense = async (
	admin: Client,
	database: StartedPostgreSqlContainer,
	key: string,
): Promise<void> => {
	await query(database, `update directus_settings set project_id = '${project}'`);

	// The guard: the key only goes to a Directus whose database has the project of the tests. Any other project would
	// take a new activation.
	if ((await projectOf(database)) !== project) {
		throw new Error('The database of Directus 12 does not have the project of the tests, so the suite kept the key.');
	}

	await postLicense(admin, key);

	// The licensing server answers a project it does not know, or one bound elsewhere, with a new one, which Directus
	// stores in its place: a new activation (V-119). Deactivating it frees the activation at once.
	const bound = await projectOf(database);

	if (bound !== project) {
		const outcome = await admin.request(customEndpoint({ path: '/license', method: 'DELETE' })).then(
			() => 'deactivated it',
			(error: unknown) => `could not deactivate it (${reasonOf(error, key)}), so it may keep one activation of the key`,
		);

		throw new Error(
			`The licensing server bound the key to a new project, ${bound}, instead of the project of the tests, and the suite ${outcome}. See D-044.`,
		);
	}
};

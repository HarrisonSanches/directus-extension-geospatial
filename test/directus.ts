import { createDirectus, type DirectusClient, rest, type RestClient, staticToken } from '@directus/sdk';
import { inject } from 'vitest';
import type { Combination } from './combinations.ts';

// The users the suite calls Directus as. Each one but the public has a static token of its own.
export type Role = 'admin' | 'maria' | 'twoPolicies' | 'public';

// What the global setup hands to the tests about the Directus of one combination.
export interface Directus {
	url: string;
	tokens: Record<Exclude<Role, 'public'>, string>;
	// The versions the containers run, read from them.
	versions: { directus: string; postgres: string; postgis: string };
	// Whether Directus accepts permissions with rules of their own, such as the row filter of Maria. Directus 12 only
	// does with a license key, and runs on the Core tier without one (V-114, D-043).
	customPermissionRules: boolean;
}

declare module 'vitest' {
	export interface ProvidedContext {
		// The combination a project of the integration suite runs, set in vitest.config.ts.
		combination: Combination;
		// The Directus of each combination the global setup started.
		directus: Partial<Record<Combination, Directus>>;
	}
}

export interface Occurrence {
	id: number;
	geometry: { type: 'Point'; coordinates: [number, number] };
	region: string;
	category: string;
	status: string;
	occurred_at: string;
}

interface Schema {
	occurrences: Occurrence[];
}

export type Client = DirectusClient<Schema> & RestClient<Schema>;

// A token of null calls Directus without a session, as the public role.
export const connect = (url: string, token: string | null): Client => {
	const client = createDirectus<Schema>(url).with(rest());

	return token === null ? client : client.with(staticToken(token));
};

// The Directus of the combination the current project runs. What differs between Directus versions stays behind here.
const current = (): Directus => {
	const combination = inject('combination');
	const directus = inject('directus')[combination];

	if (directus === undefined) {
		throw new Error(`The global setup did not start the combination ${combination}.`);
	}

	return directus;
};

// Calls Directus as one of the users of the suite.
export const as = (role: Role): Client => {
	const { url, tokens } = current();

	return connect(url, role === 'public' ? null : tokens[role]);
};

export const versions = (): Directus['versions'] => current().versions;

export const hasCustomPermissionRules = (): boolean => current().customPermissionRules;

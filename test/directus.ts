import { createDirectus, type DirectusClient, rest, type RestClient, staticToken } from '@directus/sdk';
import { inject } from 'vitest';

// The users the suite calls Directus as. Each one but the public has a static token of its own.
export type Role = 'admin' | 'maria' | 'twoPolicies' | 'public';

// What the global setup hands to the tests.
interface Directus {
	url: string;
	tokens: Record<Exclude<Role, 'public'>, string>;
	// The versions the containers run, read from them.
	versions: { directus: string; postgres: string; postgis: string };
}

declare module 'vitest' {
	export interface ProvidedContext {
		directus: Directus;
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

// Calls Directus as one of the users of the suite. What differs between Directus versions stays behind here.
export const as = (role: Role): Client => {
	const { url, tokens } = inject('directus');

	return connect(url, role === 'public' ? null : tokens[role]);
};

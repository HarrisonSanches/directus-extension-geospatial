import { createDirectus, type DirectusClient, rest, type RestClient, staticToken } from '@directus/sdk';
import { inject } from 'vitest';
import type { Combination } from './combinations.ts';
import { checkedFetch } from './contract.ts';
import type { Database, Spatial } from 'directus-geospatial-contract';

// The users the suite calls Directus as. Each one but the public has a static token of its own. The ones without a field
// read the south zone, as Maria (test/seed.ts).
export type Role =
	'admin' | 'maria' | 'twoPolicies' | 'withoutCategory' | 'withoutGeometry' | 'geometryInPart' | 'public';

// The database and the spatial extension a combination runs, with the versions as they report them.
export interface DatabaseVersions {
	database: { client: Database['client']; version: string };
	spatial: Spatial;
}

// What the global setup hands to the tests about the Directus of one combination.
export interface Directus {
	url: string;
	tokens: Record<Exclude<Role, 'public'>, string>;
	// The versions the containers run, read from them.
	versions: { directus: string } & DatabaseVersions;
	// Whether Directus accepts permissions with rules of their own, such as the row filter of Maria. Directus 12 only
	// does with a license key, and runs on the Core tier without one (V-114, D-043).
	customPermissionRules: boolean;
	// The id of the container of the database, when it runs apart from Directus, for the tests that read what reached it
	// (test/postgres.ts).
	databaseContainer?: string;
}

declare module 'vitest' {
	export interface ProvidedContext {
		// The combination a project of the integration suite runs, set in vitest.config.ts.
		combination: Combination;
		// The packages a project loads into Directus beside the extension, by their folder in the repository.
		extensions: string[];
		// Whether a project measures (test/measure/), whose Directus runs as an installation runs it: without the coverage
		// and without the other extension of the suite.
		measure: boolean;
		// The Directus of each combination the global setup started.
		directus: Partial<Record<Combination, Directus>>;
		// The folder where each Directus of the run gets a folder for the coverage of its processes (test/coverage.ts).
		coverage: string;
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
	// The same occurrences, in the collection whose reads the hooks of the other extension of the suite change.
	hooked_occurrences: Occurrence[];
}

export type Client = DirectusClient<Schema> & RestClient<Schema>;

// A token of null calls Directus without a session, as the public role. Each response of the extension goes through
// the contract (test/contract.ts).
export const connect = (url: string, token: string | null): Client => {
	const client = createDirectus<Schema>(url, { globals: { fetch: checkedFetch } }).with(rest());

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

export const databaseContainer = (): string | undefined => current().databaseContainer;

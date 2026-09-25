import type { Database } from 'directus-geospatial-contract';

// Runs one SQL statement and returns its rows.
export type Query = (sql: string) => Promise<Record<string, unknown>[]>;

export interface Versions {
	databaseVersion: string | null;
	spatialVersion: string | null;
}

const versionIn = (rows: Record<string, unknown>[]): string | null => {
	const version = rows[0]?.version;

	return typeof version === 'string' ? version : null;
};

const readers: Partial<Record<Database['client'], (query: Query) => Promise<Versions>>> = {
	postgres: async (query) => ({
		databaseVersion: versionIn(await query("select current_setting('server_version') as version")),
		// The version installed in this database, which decides the functions it has.
		spatialVersion: versionIn(await query("select extversion as version from pg_extension where extname = 'postgis'")),
	}),
	sqlite: async (query) => {
		const databaseVersion = versionIn(await query('select sqlite_version() as version'));
		// Directus checks SpatiaLite the same way: the function only exists with the extension loaded.
		const loaded = await query("select name from pragma_function_list where name = 'spatialite_version'");

		return {
			databaseVersion,
			spatialVersion: loaded.length > 0 ? versionIn(await query('select spatialite_version() as version')) : null,
		};
	},
};

// A database the extension cannot read yet gets no SQL at all.
export const readVersions = (client: Database['client'], query: Query): Promise<Versions> =>
	readers[client]?.(query) ?? Promise.resolve({ databaseVersion: null, spatialVersion: null });

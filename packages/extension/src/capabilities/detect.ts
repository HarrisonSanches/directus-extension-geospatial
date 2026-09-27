import type { Capabilities, Database, Spatial } from 'directus-geospatial-contract';

type DatabaseClient = Database['client'];

// What the database and Directus report, before any reading: the texts come as the database returns them.
export interface EnvironmentReport {
	client: DatabaseClient;
	databaseVersion: string | null;
	spatialVersion: string | null;
	directusVersion: string;
	extensionVersion: string;
	apiVersion: string;
}

// "18.6 (Debian 18.6-1.pgdg13+2)" and "18.6" both read as 18.6.
const majorMinor = (text: string | null): string | null => text?.match(/^\d+\.\d+/)?.[0] ?? null;

// The names of the Knex client classes, as getDatabaseClient() of Directus reads them.
const knexClients = new Map<string, DatabaseClient>([
	['Client_MySQL2', 'mysql'],
	['Client_PG', 'postgres'],
	['Client_CockroachDB', 'cockroachdb'],
	['Client_SQLite3', 'sqlite'],
	['Client_Oracledb', 'oracle'],
	['Client_Oracle', 'oracle'],
	['Client_MSSQL', 'mssql'],
	['Client_Redshift', 'redshift'],
]);

export const databaseClientOf = (knexClass: string): DatabaseClient => knexClients.get(knexClass) ?? 'unknown';

const spatialExtensions: Partial<Record<DatabaseClient, Spatial['name']>> = {
	postgres: 'postgis',
	sqlite: 'spatialite',
};

const spatialOf = ({ client, spatialVersion }: EnvironmentReport): Spatial | null => {
	const name = spatialExtensions[client];

	return name === undefined || spatialVersion === null ? null : { name, version: spatialVersion };
};

export const detectCapabilities = (report: EnvironmentReport): Capabilities => ({
	api: { version: report.apiVersion },
	extension: { version: report.extensionVersion },
	directus: { version: report.directusVersion },
	database: { client: report.client, version: majorMinor(report.databaseVersion) },
	spatial: spatialOf(report),
	operations: {},
});

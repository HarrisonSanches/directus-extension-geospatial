import type { Database } from 'directus-geospatial-contract';
import type { MeasuringAdapter, SelectingAdapter } from '../../db/adapter.js';
import { postgis } from '../../db/postgis.js';
import { spatialite } from '../../db/spatialite.js';

// The level of the radius in a database, with its adapter where it runs, so a level that runs without the SQL to run it
// does not compile. In the database, the adapter measures the distance; with the limit, the server measures it (D-002).
export type RadiusLevel =
	| { level: 'indexed' | 'unindexed'; adapter: MeasuringAdapter }
	| { level: 'capped'; adapter: SelectingAdapter }
	| { level: 'unavailable'; reason: string };

// A database starts with every operation unavailable, and each one enters it in an issue of its own
// (docs/padroes/banco-e-sql.md). The reason never names the database, which only the admin sees (D-042).
const notYet: RadiusLevel = { level: 'unavailable', reason: 'It does not run on the database in use yet.' };

// The level of the radius in each database Directus runs on, in one place. The type keeps it complete: a database
// without a level does not compile (D-002).
export const radiusLevels: Record<Database['client'], RadiusLevel> = {
	// In the database, with the index: the envelope reads the column inside the permitted query, and the GiST answers its
	// box (D-049).
	postgres: { level: 'indexed', adapter: postgis },
	// The circle in the database, without an index, and the distance and the natural order in the server, over at most
	// its limit of items: Directus keeps no spatial metadata in SQLite, so there is neither a spatial index nor a distance
	// in meters (D-052, V-147, V-180).
	sqlite: { level: 'capped', adapter: spatialite },
	cockroachdb: notYet,
	mysql: notYet,
	mssql: notYet,
	oracle: notYet,
	redshift: notYet,
	unknown: notYet,
};

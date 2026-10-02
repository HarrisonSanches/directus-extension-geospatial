import type { Database } from 'directus-geospatial-contract';
import type { SpatialAdapter } from '../../db/adapter.js';
import { postgis } from '../../db/postgis.js';

// The level of the radius in a database, with the envelope of its adapter where it runs, so a level that runs without
// the SQL to run it does not compile.
export type RadiusLevel =
	| { level: 'indexed' | 'unindexed' | 'capped'; envelope: SpatialAdapter['radius'] }
	| { level: 'unavailable'; reason: string };

// A database starts with every operation unavailable, and each one enters it in an issue of its own
// (docs/padroes/banco-e-sql.md). The reason never names the database, which only the admin sees (D-042).
const notYet: RadiusLevel = { level: 'unavailable', reason: 'It does not run on the database in use yet.' };

// The level of the radius in each database Directus runs on, in one place. The type keeps it complete: a database
// without a level does not compile (D-002).
export const radiusLevels: Record<Database['client'], RadiusLevel> = {
	// In the database, with the index: the envelope reads the column inside the permitted query, and the GiST answers its
	// box (D-049).
	postgres: { level: 'indexed', envelope: postgis.radius },
	sqlite: notYet,
	cockroachdb: notYet,
	mysql: notYet,
	mssql: notYet,
	oracle: notYet,
	redshift: notYet,
	unknown: notYet,
};

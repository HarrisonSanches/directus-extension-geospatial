import type { Position } from 'directus-geospatial-contract';
import type { Knex } from 'knex';

// The spatial part a database adds around the permitted query, without changing it (D-001, D-002).
interface RadiusEnvelope {
	// The query of what the user can read, as Directus built it, which the envelope reads as a subquery.
	permitted: Knex.QueryBuilder;
	// The table of the collection, which the permitted query reads by its name.
	collection: string;
	// The geometry field, a column of the table and of the permitted query, which exposes it as text, and null where a
	// policy hides it.
	geometry: string;
	// The primary key, which orders the items.
	key: string;
	center: Position;
	// In meters.
	distance: number;
	// How many items, or null for all of them, and how many to skip.
	limit: number | null;
	offset: number;
}

export interface SpatialAdapter {
	// The items within a distance of a point, out of the permitted query, in one statement. The rows keep the columns of
	// the permitted query, with the geometry as its text, which Directus turns into the values of /items (V-173).
	radius: (knex: Knex, envelope: RadiusEnvelope) => { builder: Knex.QueryBuilder };
}

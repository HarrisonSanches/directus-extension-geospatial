import type { Position } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import type { Box } from './box.js';

// How the database keeps a geometry column, which the schema of Directus does not say: it reads a geometry and a
// geography as the same type, and no SRID (V-25, V-178).
export interface SpatialColumn {
	type: 'geometry' | 'geography';
	srid: number;
}

// The spatial part a database adds around the permitted query, without changing it (D-001, D-002).
interface RadiusEnvelope {
	// The query of what the user can read, as Directus built it, which the envelope reads as a subquery.
	permitted: Knex.QueryBuilder;
	// The table of the collection, which the permitted query reads by its name.
	collection: string;
	// The geometry field, a column of the table and of the permitted query, which exposes it as text, and null where a
	// policy hides it.
	geometry: string;
	column: SpatialColumn;
	// The boxes of the first stage, in the SRID of the column, or null for none (boxesIn).
	boxes: Box[] | null;
	// The primary key, which orders the items.
	key: string;
	center: Position;
	// In meters.
	distance: number;
	// The order of the page, by the fields the permitted query exposes, or none, for the natural order of the radius,
	// the distance. Either way it ends with the primary key.
	order: { field: string; direction: 'asc' | 'desc' }[];
	// How many items, and how many to skip.
	limit: number;
	offset: number;
}

export interface SpatialAdapter {
	// The type and the SRID of a geometry column, read from the database, by the name of its table and its field.
	columnOf: (knex: Knex, collection: string, field: string) => Promise<SpatialColumn>;
	// The boxes that hold the circle in the SRID of the column, for the first stage of the filter, which the spatial
	// index answers, or null where the radius goes without them (D-007).
	boxesIn: (knex: Knex, column: SpatialColumn, center: Position, distance: number) => Promise<Box[] | null>;
	// The items within a distance of a point, out of the permitted query, in one statement. The rows keep the columns of
	// the permitted query, with the geometry as its text, which Directus turns into the values of /items (V-173), and the
	// distance from the center, in meters, in the column that distance names. Where the column keeps another SRID, the
	// rows also bring the geometry in 4326, in the column that converted names, to take its place.
	radius: (
		knex: Knex,
		envelope: RadiusEnvelope,
	) => { builder: Knex.QueryBuilder; distance: string; converted?: string };
}

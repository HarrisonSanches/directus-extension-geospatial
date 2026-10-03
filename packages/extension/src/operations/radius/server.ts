import type { Position } from 'directus-geospatial-contract';
import geographiclib from 'geographiclib-geodesic';

// What the server of the extension completes of the radius where the database tells which items are inside the circle
// and not how far they are (D-002, §7.4): the distance, by GeographicLib, the same calculation as PostGIS (D-012), and
// the natural order, over at most the limit of items the server takes.

const wgs84 = geographiclib.Geodesic.WGS84;

// The most items of a circle the server measures and orders, the volume §7.4 names (D-052).
export const serverLimit = 50_000;

const point = /^POINT\s*\(\s*(\S+)\s+(\S+)\s*\)$/;

// A point as the permitted query exposes it, in the WKT of the database. Any other geometry is one the operation does
// not measure there, and the radius fails closed.
export const pointOf = (text: unknown): Position => {
	const match = typeof text === 'string' ? point.exec(text) : null;
	const position: Position = [Number(match?.[1]), Number(match?.[2])];

	if (position.some((coordinate) => Number.isNaN(coordinate))) {
		throw new Error('The geometry of an item is not a point the radius measures.');
	}

	return position;
};

// The distance between two points, in meters over the ellipsoid.
export const distanceFrom = ([fromLongitude, fromLatitude]: Position, [toLongitude, toLatitude]: Position): number =>
	Number(wgs84.Inverse(fromLatitude, fromLongitude, toLatitude, toLongitude).s12);

// The keys in the order the database gives them: numbers by their value, and texts by their characters, as the BINARY
// collation of SQLite compares them.
const compareKeys = (a: unknown, b: unknown) => {
	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}

	const [left, right] = [String(a), String(b)];

	return left < right ? -1 : Number(left > right);
};

interface Window {
	geometry: string;
	key: string;
	center: Position;
	limit: number;
	offset: number;
	// The most rows the server orders.
	cap: number;
}

// The rows of a circle, which the database read in the order of the primary key, in the natural order of the radius:
// the distance from the center, then the key, with the window of the page. Past the cap, only the first rows by the key
// are measured and ordered, and the list says so.
export const naturalOrderOf = <Row extends Record<string, unknown>>(
	rows: Row[],
	{ geometry, key, center, limit, offset, cap }: Window,
): { rows: Row[]; distances: number[]; capped: boolean } => {
	const measured = rows
		.slice(0, cap)
		.map((row) => ({ row, distance: distanceFrom(center, pointOf(row[geometry])) }))
		.sort((a, b) => a.distance - b.distance || compareKeys(a.row[key], b.row[key]))
		.slice(offset, offset + limit);

	return {
		rows: measured.map(({ row }) => row),
		distances: measured.map(({ distance }) => distance),
		capped: rows.length > cap,
	};
};

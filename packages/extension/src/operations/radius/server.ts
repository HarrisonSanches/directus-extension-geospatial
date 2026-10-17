import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Position } from 'directus-geospatial-contract';
import geographiclib from 'geographiclib-geodesic';
import type { Key } from '../../db/adapter.js';

// What the server of the extension completes of the radius where the database tells which items are inside the circle
// and not how far they are (D-002, §7.4): the distance, by GeographicLib, the same calculation as PostGIS (D-012), and
// the natural order, over at most the limit of items the server takes.

const wgs84 = geographiclib.Geodesic.WGS84;

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

// How many rows the server measures at a time, a few milliseconds of work.
const slice = 1_000;

// Each row with its distance, measured in slices, with a turn of the event loop between them, so a large circle does not
// hold the other requests back: the partitioning of "Don't Block the Event Loop", of Node. A turn by setImmediate runs
// after the I/O of the other requests, and a resolved promise would not, since its microtasks run before. Directus
// answers 503 to every request while its event loop lags more than 500 ms (V-181).
const measuredInSlices = async <Row>(rows: Row[], measure: (row: Row) => number) => {
	const measured: { row: Row; distance: number }[] = [];

	for (let start = 0; start < rows.length; start += slice) {
		if (start > 0) {
			await nextTurn();
		}

		for (const row of rows.slice(start, start + slice)) {
			measured.push({ row, distance: measure(row) });
		}
	}

	return measured;
};

interface Window {
	geometry: string;
	key: string;
	center: Position;
	limit: number;
	offset: number;
	// The most rows the server orders.
	cap: number;
	// The distance and the key of the last item the page before saw, for the page to start right after it (D-054).
	after?: Key[];
}

// Where the page starts in the list: right after the last item the page before saw, by the distance and then the key,
// as the database does it with the keyset, or else past the offset.
const startOf = (measured: { row: Record<string, unknown>; distance: number }[], { key, offset, after }: Window) => {
	if (after === undefined) {
		return offset;
	}

	const [distance, last] = after;
	const past = measured.findIndex(
		(item) => item.distance > Number(distance) || (item.distance === distance && compareKeys(item.row[key], last) > 0),
	);

	return past === -1 ? measured.length : past;
};

// The rows of a circle, which the database read in the order of the primary key, in the natural order of the radius:
// the distance from the center, then the key, with the window of the page. Past the cap, only the first rows by the key
// are measured and ordered, and the list says so.
export const naturalOrderOf = async <Row extends Record<string, unknown>>(
	rows: Row[],
	window: Window,
): Promise<{ rows: Row[]; distances: number[]; capped: boolean }> => {
	const { geometry, key, center, limit, cap } = window;
	const ordered = (
		await measuredInSlices(rows.slice(0, cap), (row) => distanceFrom(center, pointOf(row[geometry])))
	).sort((a, b) => a.distance - b.distance || compareKeys(a.row[key], b.row[key]));
	const start = startOf(ordered, window);
	const measured = ordered.slice(start, start + limit);

	return {
		rows: measured.map(({ row }) => row),
		distances: measured.map(({ distance }) => distance),
		capped: rows.length > cap,
	};
};

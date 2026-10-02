import type { Position } from 'directus-geospatial-contract';

// A box: west, south, east and north, in degrees of WGS 84, or in the units of the SRID of a column.
export type Box = [west: number, south: number, east: number, north: number];

// A degree of latitude is at least this long, at the equator, and a degree of longitude at least this times the cosine
// of the latitude, since the ellipsoid is wider than its meridians are long (§7.6).
const shortestDegree = 110_574;

// What the box keeps to spare, against the rounding of the degrees.
const spare = 1.01;

// The boxes that hold every point within a distance of a center, for the first stage of the filter, which the spatial
// index answers (D-007). A geodesic changes latitude at most by its length over the shortest degree, and longitude at
// most by that over the cosine of the latitude farthest from the equator it reaches. Two boxes where the circle crosses
// the antimeridian, a band of every longitude where it reaches a pole, and none where it covers the world.
export const boxesOf = ([longitude, latitude]: Position, meters: number): Box[] | null => {
	const dy = (meters / shortestDegree) * spare;
	const south = latitude - dy;
	const north = latitude + dy;

	if (south <= -90 && north >= 90) {
		return null;
	}

	if (south <= -90 || north >= 90) {
		return [[-180, Math.max(south, -90), 180, Math.min(north, 90)]];
	}

	const dx = dy / Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180);

	if (dx >= 180) {
		return [[-180, south, 180, north]];
	}

	const west = longitude - dx;
	const east = longitude + dx;

	if (west < -180) {
		return [
			[west + 360, south, 180, north],
			[-180, south, east, north],
		];
	}

	if (east > 180) {
		return [
			[west, south, 180, north],
			[-180, south, east - 360, north],
		];
	}

	return [[west, south, east, north]];
};

// How many segments each side of a box is cut into, before it goes to another SRID.
const segments = 64;

// The sides of a box, each cut into short segments, as a closed ring. A projection bends the sides of a box in degrees,
// so its corners alone, in another SRID, would miss where a side bulges out (D-007).
export const ringOf = ([west, south, east, north]: Box): Position[] => {
	const along = ([fromX, fromY]: Position, [toX, toY]: Position) =>
		Array.from({ length: segments }, (_, step): Position => [
			fromX + ((toX - fromX) * step) / segments,
			fromY + ((toY - fromY) * step) / segments,
		]);

	return [
		...along([west, south], [east, south]),
		...along([east, south], [east, north]),
		...along([east, north], [west, north]),
		...along([west, north], [west, south]),
		[west, south],
	];
};

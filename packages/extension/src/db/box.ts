import type { Position } from 'directus-geospatial-contract';

// A box in degrees of WGS 84: west, south, east and north.
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

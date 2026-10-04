import type { MultiPolygon, Polygon, Position } from 'directus-geospatial-contract';
import geographiclib from 'geographiclib-geodesic';

// The circle of the radius, the shape of its result (D-022): the points at the distance from the center, on the
// ellipsoid, by GeographicLib, as the server measures (D-012), so it is the same in every database (D-055). It goes in
// GeoJSON as RFC 7946 asks: each ring closed, the outside counterclockwise and a hole clockwise, and cut at the
// antimeridian.

const wgs84 = geographiclib.Geodesic.WGS84;

// How many sides the circle has. Each side stays within 0.03% of the distance inside the circle, as the polygon D-023
// compares with for "entirely within".
export const circleSides = 128;

type Ring = Position[];

// The world, counterclockwise, from its southwest corner.
const world: Ring = [
	[-180, -90],
	[180, -90],
	[180, 90],
	[-180, 90],
];

const distanceTo = ([longitude, latitude]: Position, [toLongitude, toLatitude]: Position) =>
	Number(wgs84.Inverse(latitude, longitude, toLatitude, toLongitude).s12);

// The point at a place of a ring, counting back from the end with a negative place, as at does.
const pointAt = (ring: Ring, index: number): Position => ring.at(index) ?? [Number.NaN, Number.NaN];

// Each point of a ring with the one before it, the last one before the first.
const edgesOf = (ring: Ring): [Position, Position][] => ring.map((point, index) => [pointAt(ring, index - 1), point]);

// Twice the area a ring encloses in the plane of longitude and latitude, positive when it turns counterclockwise.
const turnOf = (ring: Ring) => edgesOf(ring).reduce((sum, [[x0, y0], [x1, y1]]) => sum + x0 * y1 - x1 * y0, 0);

// A ring without a point right after the same point, as the cut leaves where a point of the circle falls right on the
// antimeridian.
const distinctIn = (ring: Ring): Ring =>
	edgesOf(ring)
		.filter(([[x0, y0], [x1, y1]]) => x0 !== x1 || y0 !== y1)
		.map(([, point]) => point);

// A ring as GeoJSON writes it, closed by its first point. Each ring already turns the way RFC 7946 asks: the circle runs
// counterclockwise around the center, with what it holds on its left, so the outside of a polygon turns
// counterclockwise, and the cap of the other side, a hole, clockwise.
const closed = (ring: Ring): Ring => {
	const points = distinctIn(ring);

	return [...points, ...points.slice(0, 1)];
};

// The points at the distance from the center, one every 360 / circleSides degrees of azimuth, from the north to the
// west, so the ring turns counterclockwise around the center, with each longitude in [-180, 180].
const verticesOf = ([longitude, latitude]: Position, distance: number): Ring =>
	Array.from({ length: circleSides }, (_, index): Position => {
		const { lon2, lat2 } = wgs84.Direct(latitude, longitude, (-360 * index) / circleSides, distance);

		return [Number(lon2), Number(lat2)];
	});

// Each longitude moved by whole turns to within 180 degrees of the one before, so the ring runs on past the antimeridian
// instead of jumping across it.
const unwrapped = (ring: Ring): Ring => {
	let [before] = pointAt(ring, 0);

	return ring.map(([longitude, latitude]): Position => {
		before = longitude + 360 * Math.round((before - longitude) / 360);

		return [before, latitude];
	});
};

// The part of a ring on one side of a meridian, by the clipping of Sutherland and Hodgman: where the ring crosses the
// meridian, a point on it.
const clipped = (ring: Ring, meridian: number, keeps: (longitude: number) => boolean): Ring =>
	edgesOf(ring).flatMap(([[x0, y0], point]) => {
		const [x1, y1] = point;
		const crossing: Ring = keeps(x0) === keeps(x1) ? [] : [[meridian, y0 + ((y1 - y0) * (meridian - x0)) / (x1 - x0)]];

		return keeps(x1) ? [...crossing, point] : crossing;
	});

// A ring that runs past the antimeridian, cut into its part in each copy of the world it runs over, each one moved back
// into [-180, 180] (RFC 7946, 3.1.9).
const partsOf = (ring: Ring): Ring[] => {
	const longitudes = ring.map(([longitude]) => longitude);
	const first = Math.floor((Math.min(...longitudes) + 180) / 360);
	const last = Math.ceil((Math.max(...longitudes) - 180) / 360);

	return Array.from({ length: last - first + 1 }, (_, index) => {
		const turn = 360 * (first + index);
		const part = clipped(
			clipped(ring, turn - 180, (longitude) => longitude >= turn - 180),
			turn + 180,
			(longitude) => longitude <= turn + 180,
		);

		return distinctIn(part).map(([longitude, latitude]): Position => [longitude - turn, latitude]);
	}).filter((part) => turnOf(part) !== 0);
};

// A ring around a pole runs over every longitude once. It opens where it crosses the antimeridian, and closes along the
// antimeridian, through the pole.
const aroundPole = (ring: Ring, pole: number): Ring => {
	const crossing = edgesOf(ring).findIndex(([[x0], [x1]]) => Math.abs(x1 - x0) > 180);
	const opened = [...ring.slice(crossing), ...ring.slice(0, crossing)];
	const [firstLongitude, firstLatitude] = pointAt(opened, 0);
	const [lastLongitude, lastLatitude] = pointAt(opened, -1);
	const side = lastLongitude > 0 ? 180 : -180;
	// Where the side from the last point to the first crosses the antimeridian, with the first point a whole turn on.
	const latitude =
		lastLatitude +
		((firstLatitude - lastLatitude) * (side - lastLongitude)) / (firstLongitude + 2 * side - lastLongitude);

	return [[-side, latitude], ...opened, [side, latitude], [side, pole], [-side, pole]];
};

// The boundary of a part the antimeridian cut, without its side on the antimeridian: from one end on it to the other,
// up the east side of the world and down the west side, as the outside of the world turns counterclockwise.
const notchOf = (part: Ring, side: number): Ring => {
	const seam = edgesOf(part).findIndex(([[x0], [x1]]) => x0 === side && x1 === side);
	const path = [...part.slice(seam), ...part.slice(0, seam)];
	const [, startLatitude] = pointAt(path, 0);
	const [, endLatitude] = pointAt(path, -1);

	return startLatitude < endLatitude === (side === 180) ? path : path.toReversed();
};

// The world without the cap on the other side of the circle, which holds no pole: a hole in it, or, where the cap runs
// over the antimeridian, a notch on each side of the world.
const worldWithout = (ring: Ring): Ring[] => {
	const parts = partsOf(unwrapped(ring));
	const holes = parts.filter((part) => part.every(([longitude]) => Math.abs(longitude) !== 180));
	const notch = (side: number) =>
		notchOf(parts.find((part) => part.some(([longitude]) => longitude === side)) ?? [], side);

	return [
		closed([[-180, -90], [180, -90], ...notch(180), [180, 90], [-180, 90], ...notch(-180)]),
		...holes.map((hole) => closed(hole)),
	];
};

// The circle of the points at a distance in meters from a center, on the ellipsoid. With a pole inside, it goes through
// the pole, and with both, it is the world without what lies farther than the distance. From the distance to the point
// on the other side of the world, the antipode, it covers the whole world.
export const circleOf = (center: Position, distance: number): Polygon | MultiPolygon => {
	const [longitude, latitude] = center;

	if (distance >= distanceTo(center, [longitude + 180, -latitude])) {
		return { type: 'Polygon', coordinates: [closed(world)] };
	}

	const vertices = verticesOf(center, distance);
	const north = distance > distanceTo(center, [longitude, 90]);
	const south = distance > distanceTo(center, [longitude, -90]);

	if (north && south) {
		return { type: 'Polygon', coordinates: worldWithout(vertices) };
	}

	if (north || south) {
		return { type: 'Polygon', coordinates: [closed(aroundPole(vertices, north ? 90 : -90))] };
	}

	const parts = partsOf(unwrapped(vertices)).map((part) => [closed(part)]);

	return parts.length === 1
		? { type: 'Polygon', coordinates: parts.flat() }
		: { type: 'MultiPolygon', coordinates: parts };
};

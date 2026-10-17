import { fc, test } from '@fast-check/vitest';
import type { MultiPolygon, Polygon, Position } from 'directus-geospatial-contract';
import geographiclib from 'geographiclib-geodesic';
import { describe, expect, it } from 'vitest';
import { circleOf, circleSides } from './circle.js';

const wgs84 = geographiclib.Geodesic.WGS84;

const distanceBetween = ([fromLongitude, fromLatitude]: Position, [toLongitude, toLatitude]: Position) =>
	Number(wgs84.Inverse(fromLatitude, fromLongitude, toLatitude, toLongitude).s12);

// The polygons of a geometry, each as its rings.
const polygonsOf = (geometry: Polygon | MultiPolygon) =>
	geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

// The positions of a geometry, without the one that closes each ring, which repeats the first.
const positionsOf = (geometry: Polygon | MultiPolygon) =>
	polygonsOf(geometry).flatMap((rings) => rings.flatMap((ring) => ring.slice(0, -1)));

// Twice the area a closed ring encloses in the plane of longitude and latitude, positive when it turns counterclockwise.
const turnOf = (ring: Position[]) =>
	ring.slice(1).reduce((sum, [longitude, latitude], index) => {
		const [previousLongitude, previousLatitude] = ring[index] ?? [longitude, latitude];

		return sum + previousLongitude * latitude - longitude * previousLatitude;
	}, 0);

// The positions on the circle: all but the ones the cut puts on the antimeridian and on a pole.
const onTheCircle = (geometry: Polygon | MultiPolygon) =>
	positionsOf(geometry).filter(([longitude, latitude]) => Math.abs(longitude) !== 180 && Math.abs(latitude) !== 90);

// The distinct positions.
const distinct = (positions: Position[]) => new Set(positions.map((position) => position.join(' ')));

// A ring with no point right after the same point.
const isSimple = (ring: Position[]) =>
	ring.slice(1).every(([longitude, latitude], index) => {
		const [previousLongitude, previousLatitude] = ring[index] ?? [Number.NaN, Number.NaN];

		return longitude !== previousLongitude || latitude !== previousLatitude;
	});

// The side of the turn from a to b that c lies on: 1 to the left, -1 to the right, 0 on the line.
const sideOf = ([ax, ay]: Position, [bx, by]: Position, [cx, cy]: Position) =>
	Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

const within = ([ax, ay]: Position, [bx, by]: Position, [cx, cy]: Position) =>
	Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);

// Whether two segments cross or touch.
const meet = (a: Position, b: Position, c: Position, d: Position) => {
	const [abc, abd, cda, cdb] = [sideOf(a, b, c), sideOf(a, b, d), sideOf(c, d, a), sideOf(c, d, b)];

	return (
		(abc !== abd && cda !== cdb) ||
		(abc === 0 && within(a, b, c)) ||
		(abd === 0 && within(a, b, d)) ||
		(cda === 0 && within(c, d, a)) ||
		(cdb === 0 && within(c, d, b))
	);
};

// Whether two sides of a closed ring that do not follow each other cross or touch.
const crossesItself = (ring: Position[]) => {
	const sides = ring.slice(1).map((end, index): [Position, Position] => [ring[index] ?? end, end]);

	return sides.some(([a, b], index) =>
		sides.slice(index + 2, index === 0 ? -1 : undefined).some(([c, d]) => meet(a, b, c, d)),
	);
};

// The latitudes where the circle meets one side of the antimeridian.
const seamOf = (geometry: Polygon | MultiPolygon, side: 180 | -180) =>
	positionsOf(geometry)
		.filter(([longitude, latitude]) => longitude === side && Math.abs(latitude) !== 90)
		.map(([, latitude]) => latitude)
		.toSorted((a, b) => a - b);

const world: Position[] = [
	[-180, -90],
	[180, -90],
	[180, 90],
	[-180, 90],
	[-180, -90],
];

describe('o círculo do raio (D-055)', () => {
	const center: Position = [-46.7, -23.65];

	it('tem os vértices à distância, no elipsoide, a partir do norte, no anti-horário', () => {
		const geometry = circleOf(center, 10_000);
		const [[ring = [], ...holes] = []] = polygonsOf(geometry);

		expect(geometry.type).toBe('Polygon');
		expect(holes).toEqual([]);
		expect(ring).toHaveLength(circleSides + 1);
		expect(ring.at(-1)).toEqual(ring[0]);
		expect(turnOf(ring)).toBeGreaterThan(0);
		expect(ring[0]?.[0]).toBeCloseTo(center[0], 12);
		expect(ring[0]?.[1]).toBeGreaterThan(center[1]);

		for (const vertex of ring) {
			expect(distanceBetween(center, vertex)).toBeCloseTo(10_000, 6);
		}
	});

	it('tem os lados a até 0,03% do círculo, como o polígono da D-023', () => {
		const [[ring = []] = []] = polygonsOf(circleOf(center, 10_000));
		const gaps = ring.slice(1).map(([longitude, latitude], index) => {
			const [previousLongitude, previousLatitude] = ring[index] ?? [longitude, latitude];
			const middle: Position = [(previousLongitude + longitude) / 2, (previousLatitude + latitude) / 2];

			return 1 - distanceBetween(center, middle) / 10_000;
		});

		expect(Math.max(...gaps)).toBeLessThan(0.00031);
		expect(Math.min(...gaps)).toBeGreaterThan(0);
	});

	it('cortado no antimeridiano, vira dois polígonos, que se encontram nas mesmas latitudes dos dois lados', () => {
		const fiji: Position = [179.9, -17];
		const geometry = circleOf(fiji, 100_000);
		const polygons = polygonsOf(geometry);

		expect(geometry.type).toBe('MultiPolygon');
		expect(polygons).toHaveLength(2);
		expect(polygons.map((rings) => rings.length)).toEqual([1, 1]);
		expect(polygons.map(([ring = []]) => turnOf(ring) > 0)).toEqual([true, true]);
		expect(seamOf(geometry, 180)).toHaveLength(2);
		expect(seamOf(geometry, 180)).toEqual(seamOf(geometry, -180));
		expect(distinct(onTheCircle(geometry)).size).toBe(circleSides);

		for (const vertex of onTheCircle(geometry)) {
			expect(distanceBetween(fiji, vertex)).toBeCloseTo(100_000, 6);
		}
	});

	it.each([
		['perto do polo norte', [10, 89.5], 90],
		['no polo norte', [123, 90], 90],
		['perto do polo sul', [-60, -89.5], -90],
	] as [string, Position, number][])(
		'%s, com o polo dentro, vai pelo antimeridiano até o polo, num polígono só',
		(_, around, pole) => {
			const geometry = circleOf(around, 100_000);
			const [[ring = [], ...holes] = []] = polygonsOf(geometry);

			expect(geometry.type).toBe('Polygon');
			expect(holes).toEqual([]);
			expect(turnOf(ring)).toBeGreaterThan(0);
			expect(ring).toContainEqual([180, pole]);
			expect(ring).toContainEqual([-180, pole]);
			expect(seamOf(geometry, 180)).toEqual(seamOf(geometry, -180));
			expect(distinct(onTheCircle(geometry)).size).toBe(circleSides);

			for (const vertex of onTheCircle(geometry)) {
				expect(distanceBetween(around, vertex)).toBeCloseTo(100_000, 6);
			}
		},
	);

	it('com um ponto do círculo bem no antimeridiano, nenhum anel repete o ponto', () => {
		// From the meridian 0, the side to the north goes over the pole and comes down the meridian 180.
		const geometry = circleOf([0, 89.5], 100_000);

		expect(geometry.type).toBe('Polygon');
		expect(polygonsOf(geometry).flat().every(isSimple)).toBe(true);
		expect(onTheCircle(geometry)).toHaveLength(circleSides - 1);
	});

	it('com os dois polos dentro, é o mundo com um furo, longe do antimeridiano', () => {
		const geometry = circleOf([90, 0], 15_000_000);
		const [[outer = [], hole = [], ...others] = []] = polygonsOf(geometry);

		expect(geometry.type).toBe('Polygon');
		expect(outer).toEqual(world);
		expect(others).toEqual([]);
		expect(turnOf(hole)).toBeLessThan(0);
		expect(distinct(onTheCircle(geometry)).size).toBe(circleSides);

		for (const vertex of onTheCircle(geometry)) {
			expect(distanceBetween([90, 0], vertex)).toBeCloseTo(15_000_000, 6);
		}
	});

	it('com os dois polos dentro e pontos do círculo bem no antimeridiano, o recorte não cruza a si mesmo', () => {
		// From the meridian 0, the sides to the north and to the south go over the poles and come down the meridian 180.
		const geometry = circleOf([0, 0], 15_000_000);
		const [[ring = [], ...holes] = []] = polygonsOf(geometry);

		expect(holes).toEqual([]);
		expect(isSimple(ring)).toBe(true);
		expect(crossesItself(ring)).toBe(false);
		expect(onTheCircle(geometry)).toHaveLength(circleSides - 2);
	});

	it('com os dois polos dentro e o furo no antimeridiano, é o mundo com um recorte de cada lado', () => {
		const geometry = circleOf([10, 0], 15_000_000);
		const [[ring = [], ...holes] = []] = polygonsOf(geometry);

		expect(geometry.type).toBe('Polygon');
		expect(holes).toEqual([]);
		expect(turnOf(ring)).toBeGreaterThan(0);
		expect(ring).toEqual(expect.arrayContaining(world));
		expect(seamOf(geometry, 180)).toEqual(seamOf(geometry, -180));
		expect(distinct(onTheCircle(geometry)).size).toBe(circleSides);

		for (const vertex of onTheCircle(geometry)) {
			expect(distanceBetween([10, 0], vertex)).toBeCloseTo(15_000_000, 6);
		}
	});

	it('a partir da distância até o antípoda, cobre o mundo inteiro', () => {
		expect(circleOf(center, 20_100_000)).toEqual({ type: 'Polygon', coordinates: [world] });
	});

	test.prop([
		fc.double({ min: -180, max: 180, noNaN: true }),
		fc.double({ min: -89, max: 89, noNaN: true }),
		fc.double({ min: 1, max: 19_000_000, noNaN: true }),
	])(
		'em qualquer lugar e tamanho, os anéis fecham e giram como a RFC 7946 pede, dentro do mundo, e os vértices ficam à distância',
		(longitude, latitude, distance) => {
			const around: Position = [longitude, latitude];
			const geometry = circleOf(around, distance);

			for (const [outer = [], ...holes] of polygonsOf(geometry)) {
				expect(turnOf(outer)).toBeGreaterThan(0);
				expect(holes.every((hole) => turnOf(hole) < 0)).toBe(true);

				for (const ring of [outer, ...holes]) {
					expect(ring.length).toBeGreaterThanOrEqual(4);
					expect(ring.at(-1)).toEqual(ring[0]);
					expect(isSimple(ring)).toBe(true);
					expect(crossesItself(ring)).toBe(false);
				}
			}

			expect(positionsOf(geometry).every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90)).toBe(true);

			for (const vertex of onTheCircle(geometry)) {
				expect(Math.abs(distanceBetween(around, vertex) - distance)).toBeLessThan(1e-6);
			}
		},
	);
});

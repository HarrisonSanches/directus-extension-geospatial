import geographiclib from 'geographiclib-geodesic';
import { describe, expect, it } from 'vitest';
import { type Box, boxesOf, ringOf } from './box.js';

const wgs84 = geographiclib.Geodesic.WGS84;

const inside = ([west, south, east, north]: Box, [longitude, latitude]: [number, number]) =>
	longitude >= west && longitude <= east && latitude >= south && latitude <= north;

// The point at a distance of a center, along an azimuth, over the ellipsoid, by GeographicLib.
const pointAt = ([longitude, latitude]: [number, number], azimuth: number, meters: number): [number, number] => {
	const { lon2, lat2 } = wgs84.Direct(latitude, longitude, azimuth, meters);

	if (lon2 === undefined || lat2 === undefined) {
		throw new Error('GeographicLib did not return the point.');
	}

	return [lon2, lat2];
};

const centers: [number, number][] = [
	[-46.7, -23.65],
	[0, 0],
	[179.99, 10],
	[-180, -35],
	[120, 60],
	[-60, -80],
	[30, 89.95],
	[-150, -89.95],
];

const distances = [1, 1_000, 10_000, 250_000, 2_000_000, 7_700_000];

const azimuths = Array.from({ length: 24 }, (_, index) => index * 15 - 180);

describe('a caixa do primeiro estágio do raio', () => {
	it.each(centers.flatMap((center) => distances.map((meters) => [center, meters] as const)))(
		'em volta de %j, com %d m, a caixa guarda todo ponto da borda do círculo',
		(center, meters) => {
			const boxes = boxesOf(center, meters);

			if (boxes === null) {
				return;
			}

			for (const azimuth of azimuths) {
				const point = pointAt(center, azimuth, meters * (1 - 1e-9));

				expect(boxes.some((box) => inside(box, point))).toBe(true);
			}
		},
	);

	it('em São Paulo, com 10 km, a caixa fica perto do círculo', () => {
		const boxes = boxesOf([-46.7, -23.65], 10_000);

		expect(boxes).toHaveLength(1);

		const [[west, south, east, north] = [0, 0, 0, 0]] = boxes ?? [];

		// About 0.09° of latitude and 0.1° of longitude to each side, with 1% to spare.
		expect(north - south).toBeLessThan(0.19);
		expect(east - west).toBeLessThan(0.22);
	});

	it('o círculo que cruza o antimeridiano fica em duas caixas, uma de cada lado', () => {
		const boxes = boxesOf([179.99, 10], 10_000);

		expect(boxes).toHaveLength(2);
		expect(boxes?.some(([, , east]) => east === 180)).toBe(true);
		expect(boxes?.some(([west]) => west === -180)).toBe(true);
	});

	it('o círculo que chega a um polo fica numa faixa de todas as longitudes', () => {
		expect(boxesOf([30, 89.95], 10_000)).toEqual([[-180, expect.any(Number) as number, 180, 90]]);
	});

	it('o círculo largo demais para as longitudes fica numa faixa de todas elas, sem chegar a um polo', () => {
		const boxes = boxesOf([0, 10], 7_700_000);

		expect(boxes).toEqual([[-180, expect.any(Number) as number, 180, expect.any(Number) as number]]);
		expect(boxes?.[0]?.[3]).toBeLessThan(90);
	});

	it('o círculo que cobre o mundo inteiro dispensa a caixa', () => {
		expect(boxesOf([-46.7, -23.65], 20_000_000)).toBeNull();
	});
});

describe('a borda da caixa, para outro SRID', () => {
	const box: Box = [-46.8, -23.75, -46.6, -23.55];

	it('passa pelos quatro cantos e fecha onde começou', () => {
		const ring = ringOf(box);

		expect(ring.at(0)).toEqual([-46.8, -23.75]);
		expect(ring.at(-1)).toEqual([-46.8, -23.75]);
		expect(ring).toEqual(
			expect.arrayContaining([
				[-46.6, -23.75],
				[-46.6, -23.55],
				[-46.8, -23.55],
			]),
		);
	});

	it('corta cada lado em 64 trechos, todos sobre o lado', () => {
		const ring = ringOf(box);
		const [west, south, east, north] = box;

		expect(ring).toHaveLength(4 * 64 + 1);
		expect(
			ring.every(
				([longitude, latitude]) =>
					(longitude === west || longitude === east || latitude === south || latitude === north) &&
					longitude >= west &&
					longitude <= east &&
					latitude >= south &&
					latitude <= north,
			),
		).toBe(true);

		const steps = ring.slice(1).map(([longitude, latitude], index) => {
			const [previousLongitude, previousLatitude] = ring[index] ?? [longitude, latitude];

			return Math.hypot(longitude - previousLongitude, latitude - previousLatitude);
		});

		expect(Math.max(...steps)).toBeCloseTo((east - west) / 64, 12);
	});
});

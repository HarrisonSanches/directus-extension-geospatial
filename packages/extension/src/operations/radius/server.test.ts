import geographiclib from 'geographiclib-geodesic';
import { describe, expect, it } from 'vitest';
import { distanceFrom, naturalOrderOf, pointOf } from './server.js';

const wgs84 = geographiclib.Geodesic.WGS84;

const center: [number, number] = [-46.7, -23.65];

// The point at a distance from the center, northward, as WKT.
const at = (meters: number, azimuth = 0) => {
	const { lon2, lat2 } = wgs84.Direct(center[1], center[0], azimuth, meters);

	return `POINT(${String(lon2)} ${String(lat2)})`;
};

describe('o ponto que a query permitida expõe', () => {
	it.each([
		['POINT(-46.7 -23.65)', [-46.7, -23.65]],
		['POINT (-46.123456 -23.654321)', [-46.123456, -23.654321]],
		['POINT(1e-7 -0)', [1e-7, -0]],
	])('lê %s', (text, point) => {
		expect(pointOf(text)).toEqual(point);
	});

	it.each([['LINESTRING(0 0, 1 1)'], ['POINT EMPTY'], ['POINT(a b)'], [null], [42]])(
		'recusa %j, que a operação não mede',
		(text) => {
			expect(() => pointOf(text)).toThrow('The geometry of an item is not a point');
		},
	);
});

describe('a distância no servidor (D-012)', () => {
	it('é a da GeographicLib, sobre o elipsoide', () => {
		expect(distanceFrom(center, pointOf(at(9_999.999)))).toBeCloseTo(9_999.999, 6);
		expect(distanceFrom(center, center)).toBe(0);
	});
});

describe('a ordem natural no servidor', () => {
	const rowsOf = (meters: number[]) => meters.map((distance, index) => ({ id: index + 1, geometry: at(distance) }));
	const window = { geometry: 'geometry', key: 'id', center, cap: 5 };

	it('vem pela distância, e depois pela chave, com a janela da página', () => {
		const rows = rowsOf([300, 100, 200, 100, 50]);
		const { rows: page, distances, capped } = naturalOrderOf(rows, { ...window, limit: 3, offset: 1 });

		expect(page.map(({ id }) => id)).toEqual([2, 4, 3]);
		expect(distances[0]).toBeCloseTo(100, 6);
		expect(distances[1]).toBe(distances[0]);
		expect(distances[2]).toBeCloseTo(200, 6);
		expect(capped).toBe(false);
	});

	it('a chave de texto desempata como o banco a ordena', () => {
		const rows = ['b', 'c', 'a', 'b'].map((id) => ({ id, geometry: at(100) }));

		expect(naturalOrderOf(rows, { ...window, limit: 4, offset: 0 }).rows.map(({ id }) => id)).toEqual([
			'a',
			'b',
			'b',
			'c',
		]);
	});

	it('acima do limite, ordena só os primeiros pela chave, e avisa', () => {
		// Six rows, in the order of the key, as the database reads them: the sixth, the nearest, is past the limit.
		const rows = rowsOf([600, 500, 400, 300, 200, 1]);
		const { rows: page, capped } = naturalOrderOf(rows, { ...window, limit: 10, offset: 0 });

		expect(page.map(({ id }) => id)).toEqual([5, 4, 3, 2, 1]);
		expect(capped).toBe(true);
	});

	it('no limite exato, a lista está inteira', () => {
		expect(naturalOrderOf(rowsOf([5, 4, 3, 2, 1]), { ...window, limit: 10, offset: 0 }).capped).toBe(false);
	});
});

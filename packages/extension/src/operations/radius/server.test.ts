import { fc, test } from '@fast-check/vitest';
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

	it('vem pela distância, e depois pela chave, com a janela da página', async () => {
		const rows = rowsOf([300, 100, 200, 100, 50]);
		const { rows: page, distances, capped } = await naturalOrderOf(rows, { ...window, limit: 3, offset: 1 });

		expect(page.map(({ id }) => id)).toEqual([2, 4, 3]);
		expect(distances[0]).toBeCloseTo(100, 6);
		expect(distances[1]).toBe(distances[0]);
		expect(distances[2]).toBeCloseTo(200, 6);
		expect(capped).toBe(false);
	});

	it('a chave de texto desempata como o banco a ordena', async () => {
		const rows = ['b', 'c', 'a', 'b'].map((id) => ({ id, geometry: at(100) }));

		expect((await naturalOrderOf(rows, { ...window, limit: 4, offset: 0 })).rows.map(({ id }) => id)).toEqual([
			'a',
			'b',
			'b',
			'c',
		]);
	});

	it('acima do limite, ordena só os primeiros pela chave, e avisa', async () => {
		// Six rows, in the order of the key, as the database reads them: the sixth, the nearest, is past the limit.
		const rows = rowsOf([600, 500, 400, 300, 200, 1]);
		const { rows: page, capped } = await naturalOrderOf(rows, { ...window, limit: 10, offset: 0 });

		expect(page.map(({ id }) => id)).toEqual([5, 4, 3, 2, 1]);
		expect(capped).toBe(true);
	});

	it('com o cursor, a página começa logo depois do último item da anterior, pela distância e pela chave', async () => {
		const rows = rowsOf([300, 100, 200, 100, 50]);
		const [, second] = (await naturalOrderOf(rows, { ...window, limit: 2, offset: 0 })).distances;

		expect(
			(await naturalOrderOf(rows, { ...window, limit: 2, offset: 0, after: [second ?? 0, 2] })).rows.map(
				({ id }) => id,
			),
		).toEqual([4, 3]);
		expect((await naturalOrderOf(rows, { ...window, limit: 2, offset: 0, after: [1_000, 9] })).rows).toEqual([]);
	});

	// Items at a few places, so many tie on the distance, with their keys in any order.
	const places = [0, 100, 100.5, 250];
	const items = fc.uniqueArray(fc.record({ id: fc.nat(), place: fc.constantFrom(...places) }), {
		selector: ({ id }) => id,
		maxLength: 40,
	});

	test.prop([items, fc.integer({ min: 1, max: 7 })])(
		'percorrer por cursor, com páginas de qualquer tamanho, dá cada item uma vez, na ordem natural',
		async (placed, size) => {
			const rows = placed.map(({ id, place }) => ({ id, geometry: at(place) }));
			const whole = { ...window, cap: rows.length, offset: 0 };
			const expected = (await naturalOrderOf(rows, { ...whole, limit: rows.length })).rows.map(({ id }) => id);
			const seen: number[] = [];
			let after: [number, number] | undefined;

			// One turn per item at most, so a cursor that went back fails the test instead of turning forever.
			for (let turn = 0; turn <= rows.length; turn += 1) {
				const page = await naturalOrderOf(rows, { ...whole, limit: size, ...(after && { after }) });
				const last = page.rows.at(-1);

				if (last === undefined) {
					break;
				}

				seen.push(...page.rows.map(({ id }) => id));
				after = [page.distances.at(-1) ?? 0, last.id];
			}

			expect(seen).toEqual(expected);
		},
	);

	it('no limite exato, a lista está inteira', async () => {
		expect((await naturalOrderOf(rowsOf([5, 4, 3, 2, 1]), { ...window, limit: 10, offset: 0 })).capped).toBe(false);
	});

	it('mede em fatias e cede a vez ao laço de eventos entre elas, para não segurar os outros pedidos', async () => {
		const rows = Array.from({ length: 3_500 }, (_, index) => ({ id: index + 1, geometry: at(index) }));
		let turns = 0;
		let measuring = true;
		const turn = () => {
			turns += 1;

			if (measuring) {
				setImmediate(turn);
			}
		};

		setImmediate(turn);
		await naturalOrderOf(rows, { ...window, cap: 5_000, limit: 1, offset: 0 });
		measuring = false;

		// Four slices of 1,000 rows, and a turn of the event loop between each two, where the other requests go on.
		expect(turns).toBeGreaterThanOrEqual(3);
	});
});

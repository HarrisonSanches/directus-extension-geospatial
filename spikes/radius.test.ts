import { createItems, customEndpoint, readItems } from '@directus/sdk';
import geographiclib from 'geographiclib-geodesic';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { as, hasCustomPermissionRules, type Occurrence, type Role, versions } from '../test/directus.ts';
import { log } from '../test/environment.ts';

// What the radius route of the spike answers (spikes/extension/src/radius.ts).
interface Radius {
	ids: number[];
	executed: string[];
	buildMs: number;
}

const wgs84 = geographiclib.Geodesic.WGS84;

// A circle of 10 km in the south zone of São Paulo. Over 10 km, the sphere and the ellipsoid disagree by tens of
// meters, so points 2 m from the edge only fall on the right side by the geodesic distance.
const center = { longitude: -46.7, latitude: -23.65 };
const meters = 10_000;

// Points every 30° around the center, 2 m inside and 2 m outside the edge, half of them in the south zone and half in
// the north, which Maria does not read.
const aroundTheEdge: Omit<Occurrence, 'id'>[] = Array.from({ length: 12 }, (_, index) => index * 30).flatMap(
	(azimuth, index) =>
		[meters - 2, meters + 2].map((distance) => {
			const { lat2, lon2 } = wgs84.Direct(center.latitude, center.longitude, azimuth, distance);

			if (lat2 === undefined || lon2 === undefined) {
				throw new Error('GeographicLib did not return the point.');
			}

			return {
				region: index % 2 === 0 ? 'south' : 'north',
				category: 'theft',
				status: 'open',
				occurred_at: '2026-09-10T10:00:00Z',
				geometry: { type: 'Point', coordinates: [lon2, lat2] },
			};
		}),
);

const distanceOf = ({ geometry: { coordinates } }: Pick<Occurrence, 'geometry'>) => {
	const [longitude, latitude] = coordinates;
	const { s12 } = wgs84.Inverse(center.latitude, center.longitude, latitude, longitude);

	if (s12 === undefined) {
		throw new Error('GeographicLib did not return the distance.');
	}

	return s12;
};

const radius = (role: Role) =>
	as(role).request(
		customEndpoint<Radius>({
			path: '/geospatial-spikes/radius/occurrences',
			method: 'GET',
			params: { ...center, meters },
		}),
	);

// What the /items of a role returns inside the circle, by the distance of GeographicLib.
const expectedFor = async (role: Role) => {
	const items = await as(role).request(readItems('occurrences', { fields: ['id', 'geometry'], limit: -1 }));

	return items
		.filter((item) => distanceOf(item) <= meters)
		.map(({ id }) => id)
		.sort((a, b) => a - b);
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

const percentile95 = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Number.NaN;

// The envelope of this spike is the one of PostGIS. SQLite has its own, in F01-07.
describe.runIf(versions().database.client === 'postgres')('o raio sobre a query permitida, no PostGIS (F01-02)', () => {
	beforeAll(async () => {
		await as('admin').request(createItems('occurrences', aroundTheEdge));
	});

	it.runIf(hasCustomPermissionRules())(
		'o raio da Maria devolve os mesmos ids do gabarito da GeographicLib, sem os da zona norte',
		async () => {
			const expected = await expectedFor('maria');
			const everyone = await expectedFor('admin');

			expect((await radius('maria')).ids).toEqual(expected);
			// The circle holds items Maria cannot read, and items on both sides of the edge.
			expect(everyone.length).toBeGreaterThan(expected.length);
			expect(expected.length).toBeGreaterThan(0);
		},
	);

	it.runIf(hasCustomPermissionRules())(
		'a query permitida não roda sozinha: só o envelope lê as ocorrências, num SQL só',
		async () => {
			const { executed } = await radius('maria');

			expect(executed).toHaveLength(1);
			expect(executed[0]).toMatch(/ST_DWithin/);
			log(`${inject('combination')}: the envelope of Maria reached the database as ${executed[0] ?? ''}`);
		},
	);

	it.runIf(hasCustomPermissionRules())(
		'montar a query permitida da Maria, em 50 pedidos seguidos, com o mesmo resultado',
		async () => {
			const results = [];

			for (let request = 0; request < 50; request++) {
				results.push(await radius('maria'));
			}

			const [first] = results;

			expect(results.every(({ ids }) => JSON.stringify(ids) === JSON.stringify(first?.ids))).toBe(true);

			const times = results.map(({ buildMs }) => buildMs);

			log(
				`${inject('combination')}: building the permitted query of Maria took ${median(times).toFixed(2)} ms (median) and ${percentile95(times).toFixed(2)} ms (p95) over ${String(times.length)} requests`,
			);
		},
	);
});

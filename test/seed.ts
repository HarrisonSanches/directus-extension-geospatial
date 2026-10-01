import { createCollection, createItems, createPolicy, createRole, createUser } from '@directus/sdk';
import geographiclib from 'geographiclib-geodesic';
import type { Client, Occurrence } from './directus.ts';

const point = (longitude: number, latitude: number): Occurrence['geometry'] => ({
	type: 'Point',
	coordinates: [longitude, latitude],
});

// Occurrences in São Paulo. Each region and category appears more than once, so every policy lets some through and
// holds some back.
const scattered: Omit<Occurrence, 'id'>[] = [
	{
		region: 'south',
		category: 'theft',
		status: 'open',
		occurred_at: '2026-09-01T10:00:00Z',
		geometry: point(-46.7, -23.65),
	},
	{
		region: 'south',
		category: 'fire',
		status: 'closed',
		occurred_at: '2026-09-02T11:00:00Z',
		geometry: point(-46.69, -23.66),
	},
	{
		region: 'north',
		category: 'theft',
		status: 'open',
		occurred_at: '2026-09-03T12:00:00Z',
		geometry: point(-46.63, -23.48),
	},
	{
		region: 'north',
		category: 'fire',
		status: 'open',
		occurred_at: '2026-09-04T13:00:00Z',
		geometry: point(-46.64, -23.47),
	},
	{
		region: 'east',
		category: 'theft',
		status: 'closed',
		occurred_at: '2026-09-05T14:00:00Z',
		geometry: point(-46.47, -23.54),
	},
	{
		region: 'east',
		category: 'flood',
		status: 'open',
		occurred_at: '2026-09-06T15:00:00Z',
		geometry: point(-46.46, -23.55),
	},
];

export const wgs84 = geographiclib.Geodesic.WGS84;

// A circle of 10 km in the south zone of São Paulo, for the radius. Over 10 km, the sphere and the ellipsoid disagree by
// up to 40 m, so the points 2 m from the edge only fall on the right side by the geodesic distance (F01-02).
export const circle = { center: [-46.7, -23.65] as [number, number], meters: 10_000 };

// Points every 30° around the center, 2 m inside and 2 m outside the edge. Half of them are in the south zone and half
// in the north, which Maria does not read, and the status and the category vary, for the filter and the search.
const aroundTheEdge: Omit<Occurrence, 'id'>[] = Array.from({ length: 12 }, (_, index) => index * 30).flatMap(
	(azimuth, index) =>
		[circle.meters - 2, circle.meters + 2].map((distance) => {
			const [longitude, latitude] = circle.center;
			const { lat2, lon2 } = wgs84.Direct(latitude, longitude, azimuth, distance);

			if (lat2 === undefined || lon2 === undefined) {
				throw new Error('GeographicLib did not return the point.');
			}

			return {
				region: index % 2 === 0 ? 'south' : 'north',
				category: Math.floor(index / 4) % 2 === 0 ? 'theft' : 'fire',
				status: Math.floor(index / 2) % 2 === 0 ? 'open' : 'closed',
				occurred_at: '2026-09-10T10:00:00Z',
				geometry: point(lon2, lat2),
			};
		}),
);

export const occurrences: Omit<Occurrence, 'id'>[] = [...scattered, ...aroundTheEdge];

// A role whose policies each read the occurrences that match one filter. Directus joins the policies of a role with OR.
const roleWith = async (admin: Client, name: string, filters: Record<string, Record<string, unknown>>) => {
	const role = await admin.request(createRole({ name }));

	for (const [policy, filter] of Object.entries(filters)) {
		await admin.request(
			createPolicy({
				name: policy,
				admin_access: false,
				app_access: false,
				permissions: [{ collection: 'occurrences', action: 'read', fields: ['*'], permissions: filter }],
				roles: [{ role: role.id }],
			}),
		);
	}

	return role.id;
};

// A user of the role with a static token, which the suite sends to call Directus as that user.
const userWith = async (admin: Client, role: string, email: string, newSecret: () => string) => {
	const token = newSecret();

	await admin.request(createUser({ email, password: newSecret(), role, token }));

	return token;
};

// The row rule of Maria, who only reads the south zone.
export const southZone = { region: { _eq: 'south' } };

// Builds the schema, the roles and the data through the API, so each database stores them the way Directus writes to
// it. Without custom permission rules, as on the Core tier of Directus 12, the roles get no policy, and their users
// only have a session (V-114).
export const seed = async (
	admin: Client,
	newSecret: () => string,
	customPermissionRules: boolean,
): Promise<{ maria: string; twoPolicies: string }> => {
	await admin.request(
		createCollection({
			collection: 'occurrences',
			schema: {},
			meta: {},
			fields: [
				{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
				// On SQL Server, whose column is a geometry of any kind, Directus keeps the Point in its meta, and fails without
				// one (V-153).
				{ field: 'geometry', type: 'geometry.Point', schema: {}, meta: {} },
				{ field: 'region', type: 'string', schema: {} },
				{ field: 'category', type: 'string', schema: {} },
				{ field: 'status', type: 'string', schema: {} },
				// On SQLite, Directus flags a timestamp in its meta, and without a meta of its own the flag goes into one with no
				// collection and no field, which fails validation (V-122).
				{ field: 'occurred_at', type: 'timestamp', schema: {}, meta: {} },
			],
		}),
	);

	await admin.request(createItems('occurrences', occurrences));

	const maria = await roleWith(
		admin,
		'Maria, South Zone Operator',
		customPermissionRules ? { 'South zone': southZone } : {},
	);

	const twoPolicies = await roleWith(
		admin,
		'Two policies',
		customPermissionRules ? { 'North zone': { region: { _eq: 'north' } }, Theft: { category: { _eq: 'theft' } } } : {},
	);

	return {
		maria: await userWith(admin, maria, 'maria@example.com', newSecret),
		twoPolicies: await userWith(admin, twoPolicies, 'two-policies@example.com', newSecret),
	};
};

import { createCollection, createItems, createPolicy, createRole, createUser } from '@directus/sdk';
import type { Client, Occurrence } from './directus.js';

const point = (longitude: number, latitude: number): Occurrence['geometry'] => ({
	type: 'Point',
	coordinates: [longitude, latitude],
});

// Occurrences in São Paulo. Each region and category appears more than once, so every policy lets some through and
// holds some back.
export const occurrences: Omit<Occurrence, 'id'>[] = [
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

// Builds the schema, the roles and the data through the API, so each database stores them the way Directus writes to it.
export const seed = async (admin: Client, newSecret: () => string): Promise<{ maria: string; twoPolicies: string }> => {
	await admin.request(
		createCollection({
			collection: 'occurrences',
			schema: {},
			meta: {},
			fields: [
				{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true } },
				{ field: 'geometry', type: 'geometry.Point', schema: {} },
				{ field: 'region', type: 'string', schema: {} },
				{ field: 'category', type: 'string', schema: {} },
				{ field: 'status', type: 'string', schema: {} },
				{ field: 'occurred_at', type: 'timestamp', schema: {} },
			],
		}),
	);

	await admin.request(createItems('occurrences', occurrences));

	const maria = await roleWith(admin, 'Maria, South Zone Operator', { 'South zone': { region: { _eq: 'south' } } });

	const twoPolicies = await roleWith(admin, 'Two policies', {
		'North zone': { region: { _eq: 'north' } },
		Theft: { category: { _eq: 'theft' } },
	});

	return {
		maria: await userWith(admin, maria, 'maria@example.com', newSecret),
		twoPolicies: await userWith(admin, twoPolicies, 'two-policies@example.com', newSecret),
	};
};

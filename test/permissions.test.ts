import { createPolicy, readItems } from '@directus/sdk';
import { describe, expect, it } from 'vitest';
import { as, hasCustomPermissionRules } from './directus.ts';
import { occurrences, southZone } from './seed.ts';

// What the admin reads is the reference: every other user must get exactly the part of it that its policies allow.
const everything = () => as('admin').request(readItems('occurrences', { sort: ['id'] }));

describe('permissões do Directus sobre as ocorrências', () => {
	it('o admin lê todas as ocorrências', async () => {
		expect(await everything()).toHaveLength(occurrences.length);
	});

	it.runIf(hasCustomPermissionRules())('o /items da Maria devolve só as ocorrências da zona sul', async () => {
		const expected = (await everything()).filter((occurrence) => occurrence.region === 'south');

		expect(await as('maria').request(readItems('occurrences', { sort: ['id'] }))).toEqual(expected);
		expect(expected.length).toBeGreaterThan(0);
	});

	it.runIf(hasCustomPermissionRules())(
		'o /items do papel com duas políticas devolve a união das duas, e não a interseção (V-22)',
		async () => {
			const all = await everything();
			const expected = all.filter((occurrence) => occurrence.region === 'north' || occurrence.category === 'theft');

			expect(await as('twoPolicies').request(readItems('occurrences', { sort: ['id'] }))).toEqual(expected);
			// Items that only one of the policies allows.
			expect(expected.some((occurrence) => occurrence.region === 'north' && occurrence.category !== 'theft')).toBe(
				true,
			);
			expect(expected.some((occurrence) => occurrence.region !== 'north' && occurrence.category === 'theft')).toBe(
				true,
			);
		},
	);

	// It fails when Directus starts accepting the rule on the Core tier, which D-043 wants to know.
	it.skipIf(hasCustomPermissionRules())(
		'no tier Core do Directus 12, a regra da Maria é recusada (V-114)',
		async () => {
			const policy = createPolicy({
				name: 'South zone on Core',
				admin_access: false,
				app_access: false,
				permissions: [{ collection: 'occurrences', action: 'read', fields: ['*'], permissions: southZone }],
			});

			await expect(as('admin').request(policy)).rejects.toMatchObject({
				errors: [{ extensions: { code: 'RESOURCE_RESTRICTED' } }],
			});
		},
	);

	it('o público não lê as ocorrências', async () => {
		await expect(as('public').request(readItems('occurrences'))).rejects.toMatchObject({
			errors: [{ extensions: { code: 'FORBIDDEN' } }],
		});
	});
});

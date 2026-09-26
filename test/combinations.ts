// The oldest PostGIS the PostGIS project maintains, on the oldest supported Postgres, in its official image, which
// stopped being rebuilt in 2022 (V-113).
const postgis = 'postgis/postgis:14-3.2-alpine';

// The combinations of the integration suite: each Directus version of the range (D-037) with each database. Each one
// is a project of Vitest, and every test file runs in all of them.
export const combinations = {
	'11.17-postgis': { directus: 'directus/directus:11.17.4', database: postgis },
	'12-postgis': { directus: 'directus/directus:12.4.1', database: postgis },
};

export type Combination = keyof typeof combinations;

const isCombination = (name: string): name is Combination => Object.hasOwn(combinations, name);

// INTEGRATION picks some combinations by name, separated by commas, for the quick cycle and for the CI jobs. Without
// it, the suite runs all of them.
export const selectCombinations = (value: string | undefined): Combination[] => {
	const names = value === undefined || value.trim() === '' ? Object.keys(combinations) : value.split(',');

	return names.map((name) => {
		const trimmed = name.trim();

		if (!isCombination(trimmed)) {
			throw new Error(
				`INTEGRATION names an unknown combination, ${trimmed}. The combinations are ${Object.keys(combinations).join(', ')}.`,
			);
		}

		return trimmed;
	});
};

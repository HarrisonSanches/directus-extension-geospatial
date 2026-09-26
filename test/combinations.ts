// The Directus versions of the range (D-037). Each official image is pinned by the digest of its tag, so the
// combinations of one version run the same build, which the image with SpatiaLite starts from.
const directus = {
	'11.17': {
		version: '11.17.4',
		image: 'directus/directus:11.17.4@sha256:eb326f679ae847c0a776f93b972761dc2ebe84980e0b9d274a6bc31cd62809f7',
	},
	'12': {
		version: '12.4.1',
		image: 'directus/directus:12.4.1@sha256:9cc8ab88e6f1fc98d860416d89d53dd15838860c315a66c6d8ee68cb72f6b3a6',
	},
};

// The oldest PostGIS the PostGIS project maintains, on the oldest supported Postgres, in its official image, which
// stopped being rebuilt in 2022 (V-113).
const postgis = { client: 'postgres', image: 'postgis/postgis:14-3.2-alpine' } as const;

// SQLite runs inside Directus, in the file its image points to, with SpatiaLite loaded by test/spatialite/ (V-121).
const sqlite = { client: 'sqlite' } as const;

// The combinations of the integration suite: each Directus version with each database. Each one is a project of
// Vitest, and every test file runs in all of them.
export const combinations = {
	'11.17-postgis': { directus: directus['11.17'], database: postgis },
	'11.17-sqlite': { directus: directus['11.17'], database: sqlite },
	'12-postgis': { directus: directus['12'], database: postgis },
	'12-sqlite': { directus: directus['12'], database: sqlite },
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

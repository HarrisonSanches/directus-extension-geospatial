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

// The newest PostGIS, on the newest Postgres (V-104).
const postgisNewest = { client: 'postgres', image: 'postgis/postgis:18-3.6-alpine' } as const;

// SQLite runs inside Directus, in the file its image points to, with SpatiaLite loaded by test/spatialite/ (V-121).
const sqlite = { client: 'sqlite' } as const;

// The combinations of the integration suite: each Directus version with each database. Each one is a project of
// Vitest, and every test file runs in all of them. Every pull request runs the first ones, with the minimum PostGIS,
// and the night adds the newest PostGIS (D-037).
export const combinations = {
	'11.17-postgis': { directus: directus['11.17'], database: postgis, nightly: false },
	'11.17-sqlite': { directus: directus['11.17'], database: sqlite, nightly: false },
	'12-postgis': { directus: directus['12'], database: postgis, nightly: false },
	'12-sqlite': { directus: directus['12'], database: sqlite, nightly: false },
	'11.17-postgis-newest': { directus: directus['11.17'], database: postgisNewest, nightly: true },
	'12-postgis-newest': { directus: directus['12'], database: postgisNewest, nightly: true },
};

export type Combination = keyof typeof combinations;

const isCombination = (name: string): name is Combination => Object.hasOwn(combinations, name);

const names = Object.keys(combinations).filter(isCombination);

// The combinations of every pull request, and the ones of the night, which add the rest.
const pullRequestCombinations = names.filter((name) => !combinations[name].nightly);

// INTEGRATION picks some combinations by name, separated by commas, for the quick cycle and for the CI jobs. Without
// it, the suite runs the combinations of every pull request.
export const selectCombinations = (value: string | undefined): Combination[] => {
	const picked = value === undefined || value.trim() === '' ? pullRequestCombinations : value.split(',');

	return picked.map((name) => {
		const trimmed = name.trim();

		if (!isCombination(trimmed)) {
			throw new Error(
				`INTEGRATION names an unknown combination, ${trimmed}. The combinations are ${Object.keys(combinations).join(', ')}.`,
			);
		}

		return trimmed;
	});
};

// Prints the names of the combinations of a pull request, or of the night with nightly, as the JSON the jobs of the CI
// read.
if (import.meta.main) {
	process.stdout.write(JSON.stringify(process.argv[2] === 'nightly' ? names : pullRequestCombinations));
}

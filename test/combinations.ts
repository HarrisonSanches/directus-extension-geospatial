// The Directus versions of the range (D-037): the last minor of 11, and the floor of 12 and its newest minor, each in
// its last patch. Each official image is pinned by the digest of its tag, so the combinations of one version run the
// same build, which the image with SpatiaLite starts from. Renovate moves the version, the tag and the digest together,
// the floor only within its minor (.github/renovate.json5). The adapter is the one whose internals the version passes
// (F02-03), and one serves every minor of 12.
const directus = {
	'11.17': {
		version: '11.17.4',
		image: 'directus/directus:11.17.4@sha256:eb326f679ae847c0a776f93b972761dc2ebe84980e0b9d274a6bc31cd62809f7',
		adapter: '11.17',
	},
	'12.4': {
		version: '12.4.1',
		image: 'directus/directus:12.4.1@sha256:9cc8ab88e6f1fc98d860416d89d53dd15838860c315a66c6d8ee68cb72f6b3a6',
		adapter: '12',
	},
	'12': {
		version: '12.6.0',
		image: 'directus/directus:12.6.0@sha256:5a475c31cf547da604b3ef1bd85097145825ca6aab8841dc784bb08eaa21681b',
		adapter: '12',
	},
};

// The oldest PostGIS the PostGIS project maintains, on the oldest supported Postgres, in its official image, which
// stopped being rebuilt in 2022 (V-113). It follows the support policy, so it changes by hand.
const postgis = { client: 'postgres', image: 'postgis/postgis:14-3.2-alpine' } as const;

// The newest PostGIS, on the newest Postgres (V-104), which Renovate follows.
const postgisNewest = { client: 'postgres', image: 'postgis/postgis:18-3.6-alpine' } as const;

// SQLite runs inside Directus, in the file its image points to, with SpatiaLite loaded by test/spatialite/ (V-121).
const sqlite = { client: 'sqlite' } as const;

// The combinations of the integration suite: each Directus version with each database. Each one is a project of
// Vitest, and every test file runs in all of them. Every pull request runs the oldest and the newest Directus of the
// range, 11.17 and the newest 12, with the minimum PostGIS and with SQLite, and the night adds the floor of 12 and the
// newest PostGIS (D-037). A pull request that changes this file runs the ones of the night too, so a new Directus is
// tested in every combination before the merge (A-071). The newest 12 keeps the name 12, so a new minor changes its
// version and not the name of its job.
export const combinations = {
	'11.17-postgis': { directus: directus['11.17'], database: postgis, nightly: false },
	'11.17-sqlite': { directus: directus['11.17'], database: sqlite, nightly: false },
	'12-postgis': { directus: directus['12'], database: postgis, nightly: false },
	'12-sqlite': { directus: directus['12'], database: sqlite, nightly: false },
	'12.4-postgis': { directus: directus['12.4'], database: postgis, nightly: true },
	'12.4-sqlite': { directus: directus['12.4'], database: sqlite, nightly: true },
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

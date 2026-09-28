import { randomBytes } from 'node:crypto';
import {
	GenericContainer,
	getContainerRuntimeClient,
	type StartedNetwork,
	type StartedTestContainer,
	Wait,
} from 'testcontainers';

// A database outside the suite, which the proofs of the envelope run Directus 11.17 on (F01-08).
interface Dialect {
	// The image of the database, as the tests of Directus run it (V-28), pinned by the digest of its tag.
	image: string;
	// Starts the database on the network of the run, under the name database, and returns what Directus needs to reach
	// it, and what the client of the database needs inside the container.
	start: (network: StartedNetwork) => Promise<{
		container: StartedTestContainer;
		environment: Record<string, string>;
		clientEnvironment: Record<string, string>;
	}>;
	// The command of the client of the database that runs one statement inside its container.
	sqlCommand: (statement: string) => string[];
	// Statements about the gaps of the database for the catalog of the extension, which the run answers once Directus
	// created and filled the occurrences.
	probes: Readonly<Record<string, string>>;
}

// The point of the probes, in the south zone of the seed, and the tile of zoom 10 that holds it.
const point = "st_geomfromtext('POINT(-46.7 -23.65)', 4326)";
const tile = 'st_tileenvelope(10, 379, 581)';

const cockroachdb: Dialect = {
	// The newest patch of 25.4, the one the docker-compose.yml of Directus 12.4.1 names. The sandbox of its end-to-end
	// tests still names 25.3, a line that stopped receiving patches in January 2026 (V-148).
	image: 'cockroachdb/cockroach:v25.4.17@sha256:a0809a5e77166cebaa92cb974114a6740c49e1f57ee14f323c0c9801847bb84e',
	start: async (network) => {
		// The command of the sandbox of Directus 12.4.1: a single node, without TLS, with the data in memory.
		const container = await new GenericContainer(cockroachdb.image)
			.withNetwork(network)
			.withNetworkAliases('database')
			.withCommand([
				'start-single-node',
				'--cluster-name=example-single-node',
				'--insecure',
				'--store=type=mem,size=4GB',
			])
			.withExposedPorts(8080)
			.withWaitStrategy(Wait.forHttp('/health?ready=1', 8080))
			.withStartupTimeout(120_000)
			.start();

		// The configuration of the sandbox of Directus: the root user, without a password, on the default database.
		return {
			container,
			environment: {
				DB_CLIENT: 'cockroachdb',
				DB_HOST: 'database',
				DB_PORT: '26257',
				DB_DATABASE: 'defaultdb',
				DB_USER: 'root',
			},
			clientEnvironment: {},
		};
	},
	sqlCommand: (statement) => [
		'cockroach',
		'sql',
		'--insecure',
		'--database=defaultdb',
		'--format=tsv',
		'--execute',
		statement,
	],
	// The gaps of P-06: the functions of a vector tile, the nearest items by the index, and whether a predicate on the
	// column itself, and not on the text of the permitted query, uses the index (A-023). Also the text the permitted
	// query reads the geometry through, and how many digits it keeps.
	probes: {
		version: 'select version()',
		asText: 'select st_astext(geometry) from occurrences order by id desc limit 1',
		tileEnvelope: `select st_astext(${tile})`,
		// The signatures the database has for the functions of a tile, if any.
		tileSignatures:
			"select proname, pg_get_function_arguments(oid) from pg_proc where proname in ('st_asmvtgeom', 'st_asmvt') order by 1, 2",
		// PostGIS takes the bounds of the tile as a box2d.
		asMvtGeom: `select st_astext(st_asmvtgeom(st_transform(${point}, 3857), ${tile}::box2d))`,
		asMvt: `select length(st_asmvt(t)) from (select 1 as id, st_asmvtgeom(st_transform(${point}, 3857), ${tile}::box2d) as geom) as t`,
		spatialIndex: 'create index occurrences_geometry_index on occurrences using gist (geometry)',
		nearest: `select id from occurrences order by geometry <-> ${point} limit 3`,
		// The nearest items without the operator: a distance that the index filters first, then the order by the distance.
		nearestWithinPlan: `explain select id from occurrences where st_dwithin(geometry, ${point}, 0.05) order by st_distance(geometry, ${point}) limit 3`,
		intersectsPlan: `explain select id from occurrences where st_intersects(geometry, st_buffer(${point}, 0.05))`,
	},
};

// The point of the probes as Directus writes it to MySQL, without an SRID (V-27).
const planePoint = "st_geomfromtext('POINT(-46.7 -23.65)')";

const mysql: Dialect = {
	// The LTS of MySQL, the one the docker-compose.yml of Directus 12.4.1 names. The sandbox of its end-to-end tests
	// names 8.4, the LTS before it (V-151).
	image: 'mysql:9.7.2@sha256:30a0abfa7b502a496e12339b54cd07aaa70363396dc4b8e8a72a92804a505cd6',
	start: async (network) => {
		const password = randomBytes(32).toString('hex');

		// The command and the database of the sandbox of Directus, with the data in memory. The first server of the image
		// only creates the database and listens on no port.
		const container = await new GenericContainer(mysql.image)
			.withNetwork(network)
			.withNetworkAliases('database')
			.withCommand(['--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci'])
			.withEnvironment({ MYSQL_ROOT_PASSWORD: password, MYSQL_DATABASE: 'directus' })
			.withTmpFs({ '/var/lib/mysql': 'rw' })
			.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/))
			.withStartupTimeout(120_000)
			.start();

		return {
			container,
			environment: {
				DB_CLIENT: 'mysql',
				DB_HOST: 'database',
				DB_PORT: '3306',
				DB_DATABASE: 'directus',
				DB_USER: 'root',
				DB_PASSWORD: password,
			},
			// The client reads the password from the environment of its own process, and never from its command.
			clientEnvironment: { MYSQL_PWD: password },
		};
	},
	sqlCommand: (statement) => [
		'mysql',
		'--user=root',
		'--database=directus',
		'--batch',
		'--show-warnings',
		`--execute=${statement}`,
	],
	// What Directus writes to MySQL: the column, the SRID of the values, and the text the permitted query reads the
	// geometry through. Then the order of the axes of SRID 4326, a predicate between two SRIDs, and the spatial index on
	// the column as Directus creates it (P-04). None of them changes the table.
	probes: {
		version: 'select version()',
		// A point with 15 decimals, as the text of the permitted query would carry it.
		asText: "select st_astext(st_geomfromtext('POINT(-46.712345678901234 -23.612345678901234)')) as text",
		column:
			"select column_type, is_nullable from information_schema.columns where table_schema = database() and table_name = 'occurrences' and column_name = 'geometry'",
		columnSrs:
			"select coalesce(srs_id, 'none') as srs_id from information_schema.st_geometry_columns where table_schema = database() and table_name = 'occurrences' and column_name = 'geometry'",
		storedSrid: 'select distinct st_srid(geometry) from occurrences',
		axisOrder: `select st_latitude(st_geomfromtext('POINT(-46.7 -23.65)', 4326)) as srid_defined, st_latitude(st_geomfromtext('POINT(-46.7 -23.65)', 4326, 'axis-order=long-lat')) as long_lat`,
		mixedSrids: `select st_intersects(geometry, st_geomfromtext('POINT(-46.7 -23.65)', 4326)) from occurrences limit 1`,
		planeIntersects: `select count(*) from occurrences where st_intersects(geometry, st_buffer(${planePoint}, 0.05))`,
		spatialIndex: 'create spatial index occurrences_geometry_index on occurrences (geometry)',
	},
};

export const dialects = { cockroachdb, mysql } as const;

export type DialectName = keyof typeof dialects;

const isDialect = (name: string): name is DialectName => Object.hasOwn(dialects, name);

// DIALECTS picks some dialects by name, separated by commas, and without it the run takes all of them.
export const selectDialects = (value: string | undefined): DialectName[] => {
	const picked = value === undefined || value.trim() === '' ? Object.keys(dialects) : value.split(',');

	return picked.map((name) => {
		const trimmed = name.trim();

		if (!isDialect(trimmed)) {
			throw new Error(
				`DIALECTS names an unknown dialect, ${trimmed}. The dialects are ${Object.keys(dialects).join(', ')}.`,
			);
		}

		return trimmed;
	});
};

// Runs one statement inside the container of the database, from the global setup or from a test, and returns what the
// client of the database printed.
export const runSql = async (
	name: DialectName,
	{ id, clientEnvironment }: OnDialect['database'],
	statement: string,
): Promise<{ exitCode: number; output: string }> => {
	const client = await getContainerRuntimeClient();
	const { exitCode, output } = await client.container.exec(
		client.container.getById(id),
		dialects[name].sqlCommand(statement),
		{ env: clientEnvironment },
	);

	return { exitCode, output: output.trim() };
};

// What the global setup of the dialects hands to the tests about the Directus it started.
export interface OnDialect {
	url: string;
	// The container of the database, and what its client needs, for a test to run a statement in it.
	database: { id: string; clientEnvironment: Record<string, string> };
	tokens: { admin: string; maria: string; twoPolicies: string };
	// What each probe of the dialect answered, by its name.
	probes: Record<string, { statement: string; exitCode: number; output: string }>;
}

declare module 'vitest' {
	export interface ProvidedContext {
		// The database a project of the dialects runs, set in vitest.config.ts (F01-08).
		dialect: DialectName;
		// The Directus 11.17 the global setup of the dialects started on it.
		onDialect: OnDialect;
	}
}

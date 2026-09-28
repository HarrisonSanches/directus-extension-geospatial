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

// Starts the container of a database, and, when it stops before it is ready, fails with the last lines it printed,
// which go with the container.
const startPrinting = async (container: GenericContainer, name: string): Promise<StartedTestContainer> => {
	const printed: string[] = [];

	return container
		.withLogConsumer((stream) => stream.on('data', (line) => printed.push(String(line))))
		.start()
		.catch((error: unknown) => {
			throw new Error(`${name} stopped before it was ready, after printing:\n${printed.slice(-150).join('')}`, {
				cause: error,
			});
		});
};

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

// A point 11.6 km from the one of the probes, a line and a polygon, for the distances of MariaDB.
const near = "st_geomfromtext('POINT(-46.6 -23.6)')";
const line = "st_geomfromtext('LINESTRING(-46.6 -23.6, -46.6 -23.7)')";
const square = "st_geomfromtext('POLYGON((-46.6 -23.6, -46.5 -23.6, -46.5 -23.5, -46.6 -23.5, -46.6 -23.6))')";

const mariadb: Dialect = {
	// The LTS of MariaDB, the one the docker-compose.yml of Directus 12.4.1 names. The sandbox of its end-to-end tests
	// names 11, which is 11.8, the LTS before it (V-152).
	image: 'mariadb:12.3.3@sha256:805c8e104bd563d5bfa24fadd3f31cd419ea859cb5277f32b5dbf2db714f9ed1',
	start: async (network) => {
		const password = randomBytes(32).toString('hex');

		// The command and the database of the sandbox of Directus, with the data in memory. The first server of the image
		// listens on no port, and the one that stays prints its port on the line after it is ready.
		const container = await new GenericContainer(mariadb.image)
			.withNetwork(network)
			.withNetworkAliases('database')
			.withCommand(['--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci'])
			.withEnvironment({ MARIADB_ROOT_PASSWORD: password, MARIADB_DATABASE: 'directus' })
			.withTmpFs({ '/var/lib/mysql': 'rw' })
			.withWaitStrategy(Wait.forLogMessage(/port: 3306/))
			.withStartupTimeout(120_000)
			.start();

		// Directus takes MariaDB as MySQL, through the same client (V-27).
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
			clientEnvironment: { MYSQL_PWD: password },
		};
	},
	// The client of MariaDB, by its own name.
	sqlCommand: (statement) => [
		'mariadb',
		'--user=root',
		'--database=directus',
		'--batch',
		'--show-warnings',
		`--execute=${statement}`,
	],
	// What differs from MySQL: the SRID of the values and of the column, the order of the axes of SRID 4326, a predicate
	// between two SRIDs, the distances on the plane and on the sphere, for points and for other geometries (P-07), and
	// the spatial index on the column as Directus creates it. None of them changes the table.
	probes: {
		version: 'select version()',
		asText: "select st_astext(st_geomfromtext('POINT(-46.712345678901234 -23.612345678901234)')) as text",
		column:
			"select column_type, is_nullable from information_schema.columns where table_schema = database() and table_name = 'occurrences' and column_name = 'geometry'",
		columnSrid:
			"select srid from information_schema.geometry_columns where f_table_schema = database() and f_table_name = 'occurrences'",
		storedSrid: 'select distinct st_srid(geometry) from occurrences',
		axisOrder: "select st_x(st_geomfromtext('POINT(-46.7 -23.65)', 4326)) as x",
		axisOrderOption: "select st_x(st_geomfromtext('POINT(-46.7 -23.65)', 4326, 'axis-order=long-lat')) as x",
		mixedSrids: `select st_intersects(geometry, st_geomfromtext('POINT(-46.7 -23.65)', 4326)) as touches from occurrences limit 1`,
		planeDistance: `select st_distance(${planePoint}, ${near}) as distance`,
		spherePoints: `select st_distance_sphere(${planePoint}, ${near}) as distance`,
		sphereMultipoint: `select st_distance_sphere(st_geomfromtext('MULTIPOINT((-46.7 -23.65), (-46.8 -23.7))'), ${near}) as distance`,
		sphereLine: `select st_distance_sphere(${planePoint}, ${line}) as distance`,
		spherePolygon: `select st_distance_sphere(${planePoint}, ${square}) as distance`,
		spatialIndex: 'create spatial index occurrences_geometry_index on occurrences (geometry)',
	},
};

// The client of SQL Server in its image, as the sandbox of Directus runs it: as sa, without requiring encryption. It
// exits with an error when a statement fails, and quotes the names as Directus does, with the setting the spatial index
// asks for.
const sqlcmd = ['/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-No', '-b', '-I'];

// The point of the probes, one 11.6 km from it, and a square near them, in the text both types of SQL Server read, with
// the longitude first. The square turns counterclockwise, and then clockwise.
const text = {
	point: 'POINT(-46.7 -23.65)',
	near: 'POINT(-46.6 -23.6)',
	square: 'POLYGON((-46.6 -23.6, -46.5 -23.6, -46.5 -23.5, -46.6 -23.5, -46.6 -23.6))',
	clockwise: 'POLYGON((-46.6 -23.6, -46.6 -23.5, -46.5 -23.5, -46.5 -23.6, -46.6 -23.6))',
};

// The plane, the type of the column Directus creates (V-27), and the ellipsoid, which measures in meters.
const planeOf = (wkt: string) => `geometry::STGeomFromText('${wkt}', 4326)`;
const ellipsoidOf = (wkt: string) => `geography::STGeomFromText('${wkt}', 4326)`;

const mssql: Dialect = {
	// The newest cumulative update of SQL Server 2025, the one 2025-latest names in the docker-compose.yml of Directus
	// 12.4.1. The sandbox of its end-to-end tests names 2022 (V-153).
	image:
		'mcr.microsoft.com/mssql/server:2025-CU9-ubuntu-24.04@sha256:2b5b581621126574f3d1f75e78d3eebe8d05aedb59ad0cfdf9aa42cb0634d726',
	start: async (network) => {
		// SQL Server takes a password with three of the four kinds of characters.
		const password = `${randomBytes(32).toString('hex')}-A`;
		const clientEnvironment = { SQLCMDPASSWORD: password };

		// The edition and the data of the sandbox of Directus: Express, which is free, in memory. The image starts only
		// with its license accepted, as the tests of Directus accept it. Twice in eleven runs, sqlservr crashed before it
		// was ready (V-153).
		const container = await startPrinting(
			new GenericContainer(mssql.image)
				.withNetwork(network)
				.withNetworkAliases('database')
				.withEnvironment({ ACCEPT_EULA: 'Y', MSSQL_PID: 'Express', MSSQL_SA_PASSWORD: password })
				.withTmpFs({ '/var/opt/mssql/data': 'rw' })
				.withWaitStrategy(Wait.forLogMessage(/Recovery is complete/))
				.withStartupTimeout(180_000),
			'SQL Server',
		);

		// Directus takes a database that exists, and the image has only the ones of the system.
		const created = await container.exec([...sqlcmd, '-Q', 'create database directus'], { env: clientEnvironment });

		if (created.exitCode !== 0) {
			await container.stop();
			throw new Error(`SQL Server did not create the database of Directus: ${created.output}`);
		}

		return {
			container,
			environment: {
				DB_CLIENT: 'mssql',
				DB_HOST: 'database',
				DB_PORT: '1433',
				DB_DATABASE: 'directus',
				DB_USER: 'sa',
				DB_PASSWORD: password,
			},
			// The client reads the password from the environment of its own process, and never from its command.
			clientEnvironment,
		};
	},
	// Only the values, one row per line and the columns apart by tabs, without the count of the rows.
	sqlCommand: (statement) => [
		...sqlcmd,
		'-d',
		'directus',
		'-h',
		'-1',
		'-W',
		'-s',
		'\t',
		'-Q',
		`set nocount on; ${statement}`,
	],
	// What Directus writes to SQL Server: the column, the SRID of the values, and the text the permitted query reads the
	// geometry through. Then the order of the axes of geography, the distances on the plane and on the ellipsoid, the
	// ring of a polygon on the ellipsoid, and the spatial index, whose bounds a geometry index asks for. With the index
	// forced, a plan that cannot take it fails.
	probes: {
		version: "select serverproperty('ProductVersion'), serverproperty('Edition')",
		// A point with 15 decimals, as the text of the permitted query would carry it.
		asText: `select ${planeOf('POINT(-46.712345678901234 -23.612345678901234)')}.STAsText()`,
		column:
			"select type_name(user_type_id), is_nullable from sys.columns where object_id = object_id('occurrences') and name = 'geometry'",
		storedSrid: 'select distinct [geometry].STSrid from occurrences',
		// The text puts the longitude first, and the Point method of geography the latitude.
		ellipsoidLatitude: `select ${ellipsoidOf(text.point)}.Lat`,
		ellipsoidPoint: 'select geography::Point(-23.65, -46.7, 4326).STAsText()',
		planeDistance: `select ${planeOf(text.point)}.STDistance(${planeOf(text.near)})`,
		// The geometry of the permitted query, as text, taken to the ellipsoid.
		ellipsoidDistance: `select geography::STGeomFromText(${planeOf(text.point)}.STAsText(), 4326).STDistance(${ellipsoidOf(text.near)})`,
		area: `select ${ellipsoidOf(text.square)}.STArea()`,
		clockwiseArea: `select ${ellipsoidOf(text.clockwise)}.STArea()`,
		spatialIndexWithoutBounds: 'create spatial index occurrences_geometry_index on occurrences ([geometry])',
		spatialIndex:
			'create spatial index occurrences_geometry_index on occurrences ([geometry]) with (bounding_box = (-180, -90, 180, 90))',
		// A predicate on the column takes the index, and one on the text of the permitted query does not (A-023). The
		// nearest items take it within a distance, and the hint does not take the form without one.
		columnIntersects: `select id from occurrences with (index(occurrences_geometry_index)) where [geometry].STIntersects(${planeOf(text.point)}.STBuffer(0.05)) = 1`,
		textIntersects: `select id from occurrences with (index(occurrences_geometry_index)) where geometry::STGeomFromText([geometry].STAsText(), 4326).STIntersects(${planeOf(text.point)}.STBuffer(0.05)) = 1`,
		nearest: `select top (3) id from occurrences with (index(occurrences_geometry_index)) where [geometry].STDistance(${planeOf(text.point)}) is not null order by [geometry].STDistance(${planeOf(text.point)})`,
		nearestWithin: `select top (3) id from occurrences with (index(occurrences_geometry_index)) where [geometry].STDistance(${planeOf(text.point)}) < 0.05 order by [geometry].STDistance(${planeOf(text.point)})`,
	},
};

// What SQL*Plus prints: only the values, one row per line and the columns apart by tabs, the numbers and the text
// whole, no variable read from an ampersand, and an exit with an error when a statement fails.
const sqlplus = [
	'whenever sqlerror exit failure',
	'whenever oserror exit failure',
	'set heading off feedback off verify off define off pagesize 0 linesize 32767 trimout on tab off',
	'set long 1000000 longchunksize 1000000 numwidth 40',
	"set colsep '\t'",
].join('\n');

// The plane, where the envelope compares, as PostGIS does on a geometry, and the ellipsoid, since Oracle takes SRID 4326
// as geodetic, with the sides of a polygon along geodesics. The constructor of sdo_geometry takes no null SRID, which
// more than one of its signatures would match, and the text without an SRID goes through from_wktgeometry.
const cartesianOf = (wkt: string) => `sdo_util.from_wktgeometry('${wkt}')`;
const geodeticOf = (wkt: string) => `sdo_geometry('${wkt}', 4326)`;

// A band of 1° along the parallel of -23.6, whose south side bows as a geodesic 89 m south of the straight line in the
// middle (GeographicLib), and a point 22 m south of the middle of the straight line, turning counterclockwise.
const band = 'POLYGON((-47 -23.6, -46 -23.6, -46 -23.5, -47 -23.5, -47 -23.6))';
const southOfTheSide = 'POINT(-46.5 -23.6002)';

// The plan Oracle takes for a statement, in its basic format.
const planOf = (statement: string) =>
	`explain plan for ${statement};\nselect plan_table_output from table(dbms_xplan.display(format => 'BASIC'))`;

const onTheColumn = `select count(*) from "occurrences" where sdo_anyinteract("geometry", ${geodeticOf(band)}) = 'TRUE'`;
const onTheText = `select count(*) from "occurrences" o where sdo_anyinteract(sdo_geometry(sdo_util.to_wktgeometry(o."geometry"), 4326), ${geodeticOf(band)}) = 'TRUE'`;

const oracle: Dialect = {
	// The newest release of Oracle Database Free 23, the one 23-slim names in the docker-compose.yml of Directus 12.4.1,
	// in the regular flavor. The slim flavor, the one Directus names there and in the sandbox of its end-to-end tests,
	// uninstalls Oracle Spatial, and Directus cannot create a column of sdo_geometry on it (V-154).
	image: 'gvenzl/oracle-free:23.26.3@sha256:7ed34d0ade89c91a553c9cbe9d42457c758fa29a762aaaa3137541ff30a2d1cb',
	start: async (network) => {
		// Oracle takes a password that starts with a letter.
		const password = `D${randomBytes(16).toString('hex')}`;

		// The configuration of the sandbox of Directus: a random password for the system, and a user of its own in the
		// pluggable database FREEPDB1. The image prints its line once that user exists.
		const container = await startPrinting(
			new GenericContainer(oracle.image)
				.withNetwork(network)
				.withNetworkAliases('database')
				.withEnvironment({ ORACLE_RANDOM_PASSWORD: 'yes', APP_USER: 'directus', APP_USER_PASSWORD: password })
				.withWaitStrategy(Wait.forLogMessage(/DATABASE IS READY TO USE!/))
				.withStartupTimeout(300_000),
			'Oracle',
		);

		return {
			container,
			environment: {
				DB_CLIENT: 'oracledb',
				DB_HOST: 'database',
				DB_PORT: '1521',
				DB_DATABASE: 'FREEPDB1',
				DB_USER: 'directus',
				DB_PASSWORD: password,
			},
			clientEnvironment: { SQL_USER: 'directus', SQL_PASSWORD: password },
		};
	},
	// SQL*Plus of the image, which reads the user and the password from the environment of its own process, through its
	// input, and never from its command.
	sqlCommand: (statement) => [
		'bash',
		'-c',
		'printf "%s\\n" "$1" "connect $SQL_USER/\\"$SQL_PASSWORD\\"@//localhost/FREEPDB1" "$2;" exit | sqlplus -S -L /nolog',
		'sqlplus',
		sqlplus,
		statement,
	],
	// What Directus writes to Oracle: the column, the SRID of the values, and the text the permitted query reads the
	// geometry through, with no spatial metadata. Then a point near a side, on the plane and on the ellipsoid, a text
	// that a case when of the permitted query leaves null, and the distance on the ellipsoid. Then a spatial operator
	// without an index, the index without the metadata and what it registers of them, and the plans of the operator on
	// the column and on the text of the permitted query, with the nearest items.
	probes: {
		version: "select version_full from product_component_version where product like 'Oracle%'",
		// A point with 15 decimals, as the text of the permitted query would carry it.
		asText: `select sdo_util.to_wktgeometry(${geodeticOf('POINT(-46.712345678901234 -23.612345678901234)')}) from dual`,
		column:
			"select data_type || ' ' || nullable from user_tab_columns where table_name = 'occurrences' and column_name = 'geometry'",
		storedSrid: 'select distinct o."geometry".sdo_srid from "occurrences" o',
		metadata: 'select count(*) from user_sdo_geom_metadata',
		cartesianSide: `select sdo_geom.relate(${cartesianOf(southOfTheSide)}, 'anyinteract', ${cartesianOf(band)}, 0.000000001) from dual`,
		geodeticSide: `select sdo_geom.relate(${geodeticOf(southOfTheSide)}, 'anyinteract', ${geodeticOf(band)}, 0.005) from dual`,
		nullText: `select nvl(sdo_geom.relate(sdo_util.from_wktgeometry(to_clob(null)), 'anyinteract', ${cartesianOf('POINT(0 0)')}, 0.000000001), 'NULL') from dual`,
		geodeticDistance: `select sdo_geom.sdo_distance(${geodeticOf(text.point)}, ${geodeticOf(text.near)}, 0.005, 'unit=M') from dual`,
		operatorWithoutIndex: onTheColumn,
		spatialIndex:
			'create index "occurrences_geometry_index" on "occurrences" ("geometry") indextype is mdsys.spatial_index_v2',
		indexStatus:
			"select index_type || ' ' || status || ' ' || domidx_opstatus from user_indexes where index_name = 'occurrences_geometry_index'",
		metadataAfterIndex: "select table_name || ' ' || column_name || ' ' || srid from user_sdo_geom_metadata",
		columnPlan: planOf(onTheColumn),
		textPlan: planOf(onTheText),
		nearest: `select "id" from "occurrences" where sdo_nn("geometry", ${geodeticOf(text.point)}, 'sdo_num_res=3') = 'TRUE'`,
	},
};

export const dialects = { cockroachdb, mysql, mariadb, mssql, oracle } as const;

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

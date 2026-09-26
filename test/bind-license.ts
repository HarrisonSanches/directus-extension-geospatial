import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { combinations } from './combinations.ts';
import { connect } from './directus.ts';
import { bindLicense, publicUrl, readLicenseKey } from './license.ts';

// Binds the license key to a project the licensing server picks, and prints it for test/license.ts (D-044). It takes
// one activation of the key, which stays bound after the containers stop, so it runs once, with the consent of the
// maintainer, while the tests have no activation of their own.

const newSecret = () => randomBytes(32).toString('hex');

const bind = async (key: string): Promise<string> => {
	const images = combinations['12-postgis'];
	const network = await new Network().start();

	const database = await new PostgreSqlContainer(images.database)
		.withNetwork(network)
		.withNetworkAliases('database')
		.withDatabase('directus')
		.withUsername('directus')
		.withPassword(newSecret())
		.start();

	const adminToken = newSecret();

	// The same image and public URL as the suite, without the extension, which the license does not need.
	const directus = await new GenericContainer(images.directus)
		.withNetwork(network)
		.withEnvironment({
			DB_CLIENT: 'pg',
			DB_HOST: 'database',
			DB_PORT: '5432',
			DB_DATABASE: database.getDatabase(),
			DB_USER: database.getUsername(),
			DB_PASSWORD: database.getPassword(),
			SECRET: newSecret(),
			ADMIN_EMAIL: 'admin@example.com',
			ADMIN_PASSWORD: newSecret(),
			ADMIN_TOKEN: adminToken,
			PUBLIC_URL: publicUrl,
		})
		.withExposedPorts(8055)
		.withWaitStrategy(Wait.forHttp('/server/ping', 8055))
		.withStartupTimeout(180_000)
		.start();

	try {
		const url = `http://${directus.getHost()}:${String(directus.getMappedPort(8055))}`;

		return await bindLicense(connect(url, adminToken), database, key);
	} finally {
		// The activation lives on the licensing server, so the containers go without deactivating it.
		await directus.stop();
		await database.stop();
		await network.stop();
	}
};

const key = await readLicenseKey();

if (key === undefined) {
	process.stderr.write('DIRECTUS_LICENSE_KEY is empty or missing: set it in test/.env, as test/.env.example says.\n');
	process.exitCode = 1;
} else {
	const project = await bind(key);

	process.stdout.write(`The licensing server bound the key of the tests to the project ${project}.\n`);
	process.stdout.write('Write it as the project of the tests in test/license.ts.\n');
}

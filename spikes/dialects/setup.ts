import { performance } from 'node:perf_hooks';
import { GenericContainer, Network, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { combinations } from '../../test/combinations.ts';
import { connect } from '../../test/directus.ts';
import { copiesOf, log, newSecret, seconds, urlOf } from '../../test/environment.ts';
import { seed } from '../../test/seed.ts';
import { dialects, type OnDialect, runSql } from './dialects.ts';

// The Directus of the proofs of the envelope: the 11.17 of the suite, where the row rule of Maria needs no key. On
// Directus 12, Maria would take the key on a database of another project, and another activation (D-043, D-044).
const directusImage = combinations['11.17-postgis'].directus.image;

// Only the extension of the spikes: the envelope is its route, and neither the extension nor the hook of the spikes
// knows these databases.
const packages = ['spikes/extension'];

// Starts the database of the project and Directus 11.17 on it, builds the schema, the roles and the data through the
// API, and answers the probes of the dialect. Everything stops when the run ends, or at once when a step fails.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	const name = project.config.provide.dialect;

	if (name === undefined) {
		throw new Error('The global setup of the dialects runs only in a project of the dialects (vitest.config.ts).');
	}

	const dialect = dialects[name];
	const stops: (() => Promise<unknown>)[] = [];

	const stop = async () => {
		for (const next of stops.reverse()) {
			await next();
		}
	};

	try {
		const network = await new Network().start();

		stops.push(() => network.stop());

		const startedAt = performance.now();
		const { container: database, environment, clientEnvironment } = await dialect.start(network);

		stops.push(() => database.stop());
		log(`${name}: the database started in ${seconds(startedAt)} s`);

		const token = newSecret();
		const copies = await copiesOf(packages);
		const directusAt = performance.now();

		const directus: StartedTestContainer = await new GenericContainer(directusImage)
			.withNetwork(network)
			.withEnvironment({
				...environment,
				SECRET: newSecret(),
				ADMIN_EMAIL: 'admin@example.com',
				ADMIN_PASSWORD: newSecret(),
				ADMIN_TOKEN: token,
				// Directus exits if an extension fails to load, instead of answering 404 on its routes.
				EXTENSIONS_MUST_LOAD: 'true',
				TELEMETRY: 'false',
			})
			.withCopyFilesToContainer(copies.map(({ files }) => files))
			.withCopyDirectoriesToContainer(copies.map(({ directories }) => directories))
			.withExposedPorts(8055)
			.withWaitStrategy(Wait.forHttp('/server/ping', 8055))
			.withStartupTimeout(180_000)
			.start();

		stops.push(() => directus.stop());
		log(`${name}: Directus 11.17 started in ${seconds(directusAt)} s`);

		const url = urlOf(directus);
		const tokens = await seed(connect(url, token), newSecret, true);

		// One after the other, since a probe may depend on what an earlier one created, as the index.
		const probes: OnDialect['probes'] = {};
		const reach = { id: database.getId(), clientEnvironment };

		for (const [probe, statement] of Object.entries(dialect.probes)) {
			probes[probe] = { statement, ...(await runSql(name, reach, statement)) };
		}

		project.provide('onDialect', { url, tokens: { admin: token, ...tokens }, database: reach, probes });
	} catch (error) {
		await stop();
		throw error;
	}

	return stop;
}

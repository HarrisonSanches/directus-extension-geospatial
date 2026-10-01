import type { ApiExtensionContext } from '@directus/types';
import type { Internals } from 'directus-geospatial-contract';
import type { Logger } from 'pino';
import { adapters } from './adapters.js';
import type { Context } from './chain.js';
import { checkInternals } from './check.js';
import { load } from './modules.js';

interface Startup {
	getSchema: () => Promise<Context['schema']>;
	database: ApiExtensionContext['database'];
	logger: Pick<Logger, 'info' | 'warn' | 'error'>;
	// The check of the adapters against the running Directus, which a test runs over a fake loader.
	check?: (context: Context) => Promise<Internals>;
}

const report = (logger: Startup['logger'], internals: Internals) => {
	if (internals.status === 'accepted') {
		logger.info({ adapter: internals.adapter }, `The internals of Directus passed the adapter ${internals.adapter}`);
	} else {
		logger.warn(
			{ problems: internals.problems },
			'No adapter of the extension takes the internals of this Directus, so the geospatial operations are off',
		);
	}
};

// Checks the internals once for the process, since the Directus that runs never changes while it runs (§5, protection
// 2). The check starts when the extension loads, the log says how it went, and the routes wait for its result. Reading
// the schema is the part of the database, and not of the internals, so after a failure the next read checks again.
export const checkOnStartup = ({
	getSchema,
	database,
	logger,
	check = (context) => checkInternals(adapters, load, context),
}: Startup): (() => Promise<Internals>) => {
	let checking: Promise<Internals> | undefined;

	const internals = () => {
		checking ??= (async () => {
			const result = await check({ schema: await getSchema(), knex: database });

			report(logger, result);

			return result;
		})().catch((error: unknown) => {
			checking = undefined;

			throw error;
		});

		return checking;
	};

	internals().catch((error: unknown) => {
		logger.error(error, 'Could not check the internals of Directus, and the next read checks again');
	});

	return internals;
};

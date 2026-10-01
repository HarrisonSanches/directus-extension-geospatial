import type { Internals } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InternalsUnsupportedError } from '../errors.js';
import { adapters } from './adapters.js';
import type { Context, Request } from './chain.js';
import { functions, InternalsMismatchError, type Load, load as loadDirectus, takeFrom } from './modules.js';

export type PermittedQuery = (request: Request, context: Context) => Promise<{ builder: Knex.QueryBuilder }>;

// The permitted query of a request (D-001), built by the adapter the check accepted for the running Directus, without
// running it. With the internals refused, every operation is off, and the request never reaches the chain (§5,
// protection 2). A step that returns another shape at the time of a request turns the operation off the same way, and
// the shape goes to the log, since the response carries no detail of the internals.
export const permittedQueryWith =
	(internals: () => Promise<Internals>, logger: Pick<Logger, 'error'>, load: Load = loadDirectus): PermittedQuery =>
	async (request, context) => {
		const checked = await internals();
		const adapter = checked.status === 'accepted' ? adapters.find(({ name }) => name === checked.adapter) : undefined;

		if (adapter === undefined) {
			throw new InternalsUnsupportedError();
		}

		// Node keeps each module after its first import, the one of the check, so these cost nothing.
		const modules = new Map(
			await Promise.all(
				adapter.uses.map(async (name) => {
					const path = functions[name].module;

					return [path, await load(path)] as const;
				}),
			),
		);

		try {
			return await adapter.permittedQuery(takeFrom(modules), request, context);
		} catch (error) {
			if (error instanceof InternalsMismatchError) {
				logger.error(error, 'The internals of Directus changed shape, so the geospatial operations are off');

				throw new InternalsUnsupportedError();
			}

			throw error;
		}
	};

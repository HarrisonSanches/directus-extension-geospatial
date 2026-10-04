import type { Query } from '@directus/types';
import type { Internals } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { acceptedWith, offOnMismatch } from './accepted.js';
import { chain, type Context, type Request } from './chain.js';
import { type Load, load as loadDirectus } from './modules.js';

// The permitted query of a request, the query of the page as the hooks of items.query returned it, which the operation
// reads its page by, and the fields Directus keeps of each item, which /items would give. The query of the request is
// the page as Directus sanitized it for /items, and queryOf says what the operation asks of the chain out of what the
// hooks returned.
export type PermittedQuery = (
	request: Request,
	context: Context,
	queryOf?: (hooked: Query) => Query,
) => Promise<{ builder: Knex.QueryBuilder; query: Query; fields: string[] }>;

// The permitted query of a request (D-001), built by the adapter the check accepted for the running Directus, without
// running it, in the order of the readByQuery of the ItemsService: what that Directus does before the hooks, the hooks
// of items.query, and the chain (V-144). With the internals refused, every operation is off, and the request never
// reaches the chain (§5, protection 2). A step that returns another shape at the time of a request turns the operation
// off the same way, and the shape goes to the log, since the response carries no detail of the internals.
export const permittedQueryWith = (
	internals: () => Promise<Internals>,
	logger: Pick<Logger, 'error'>,
	load: Load = loadDirectus,
): PermittedQuery => {
	const accepted = acceptedWith(internals, load);

	return async (request, context, queryOf = (hooked) => hooked) => {
		const { adapter, take } = await accepted();
		const { collection, accountability } = request;

		return offOnMismatch(async () => {
			await adapter.beforeHooks(take, request, context);

			// The hooks of other extensions change the query as the readByQuery lets them: through the emitter of the core
			// events, where their filters register, with the same events, meta and context. The emitter in the context of
			// an extension never reaches them (A-024).
			const query = await take('emitFilter')(
				['items.query', `${collection}.items.query`],
				request.query,
				{ collection },
				{ database: context.knex, schema: context.schema, accountability },
			);

			const { builder, fields } = await chain(take, { collection, query: queryOf(query), accountability }, context);

			return { builder, query, fields };
		}, logger);
	};
};

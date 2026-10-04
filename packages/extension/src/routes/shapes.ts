import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Internals, QueryShapesResponse } from 'directus-geospatial-contract';
import { databaseClientOf } from '../capabilities/detect.js';
import { knexClassOf } from '../db/client.js';
import type { PageQuery } from '../internals/page.js';
import type { PermittedQuery } from '../internals/permitted.js';
import { radiusLevels } from '../operations/radius/levels.js';
import { radiusShapes } from '../operations/radius/shapes.js';
import { accountabilityOf, cursorIn, queryIdOf } from '../operations/request.js';
import { pageOfPart, questionOf } from '../query/register.js';
import type { Registry } from '../query/registry.js';

// The part of a request of Express the route of the shapes reads, with what Directus attaches to it (directus.d.ts).
interface Incoming {
	params: Record<string, string>;
	query: Record<string, unknown>;
	sanitizedQuery: Query;
	accountability?: Accountability;
	schema: SchemaOverview;
}

interface Engines {
	internals: () => Promise<Internals>;
	permittedQuery: PermittedQuery;
	pageQuery: PageQuery;
	registry: Registry;
}

// The shapes of a registered query, by its id (D-022): the question of the registration, with the permissions of whoever
// asks now, and the limit and the cursor of the URL.
export const queryShapes = async (
	context: ApiExtensionContext,
	incoming: Incoming,
	{ internals, permittedQuery, pageQuery, registry }: Engines,
): Promise<QueryShapesResponse> => {
	const question = await questionOf(registry, queryIdOf(String(incoming.params.id)));
	const page = await pageOfPart(
		question,
		{ page: incoming.sanitizedQuery, raw: incoming.query },
		(raw) => pageQuery(raw, incoming.schema, incoming.accountability),
		['limit'],
	);

	return radiusShapes(
		{
			collection: question.collection,
			geo: question.geo,
			page,
			accountability: accountabilityOf(incoming.accountability),
			cursor: cursorIn(incoming.query.cursor),
		},
		{
			knex: context.database,
			schema: incoming.schema,
			client: databaseClientOf(knexClassOf(context.database)),
			internals,
			permittedQuery,
			// As getDBQuery reads it for /items (V-176).
			defaultLimit: Number(context.env.QUERY_LIMIT_DEFAULT),
			levels: radiusLevels,
		},
	);
};

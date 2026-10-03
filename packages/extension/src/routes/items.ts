import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Geo, Internals, ItemsResponse } from 'directus-geospatial-contract';
import { databaseClientOf } from '../capabilities/detect.js';
import { knexClassOf } from '../db/client.js';
import type { PageQuery } from '../internals/page.js';
import type { PermittedQuery } from '../internals/permitted.js';
import { radiusItems } from '../operations/radius/items.js';
import { radiusLevels } from '../operations/radius/levels.js';
import { accountabilityOf, geoOf, searchOf, searchPageOf } from '../operations/request.js';

// What the routes read of a request: the collection of the path, the geo checked against the contract, the page of
// /items, and what Directus attached to the request.
interface ItemsRequest {
	collection: string;
	geo: Geo;
	page: Query;
	accountability: Accountability | undefined;
	schema: SchemaOverview;
}

interface Engines {
	internals: () => Promise<Internals>;
	permittedQuery: PermittedQuery;
}

// The format of /items with the spatial operation of the geo (D-016, V-11). The geo went through the contract first,
// so a request off it never reaches the database.
const readItems = (
	context: ApiExtensionContext,
	{ collection, geo, page, accountability, schema }: ItemsRequest,
	{ internals, permittedQuery }: Engines,
): Promise<ItemsResponse> =>
	radiusItems(
		{ collection, geo, page, accountability: accountabilityOf(accountability) },
		{
			knex: context.database,
			schema,
			client: databaseClientOf(knexClassOf(context.database)),
			internals,
			permittedQuery,
			logger: context.logger.child({ extension: 'geospatial' }),
			// As runAst reads the rows for /items, with the PayloadService of the running Directus (V-173).
			valuesOf: (name, rows) =>
				new context.services.PayloadService(name, { knex: context.database, schema }).processValues('read', rows),
			// As getDBQuery reads it for /items (V-176).
			defaultLimit: Number(context.env.QUERY_LIMIT_DEFAULT),
			levels: radiusLevels,
		},
	);

// The part of a request of Express the routes of items read, with what Directus attaches to it (directus.d.ts).
export interface Incoming {
	params: Record<string, string>;
	query: Record<string, unknown>;
	body?: unknown;
	headers: Record<string, string | string[] | undefined>;
	sanitizedQuery: Query;
	accountability?: Accountability;
	schema: SchemaOverview;
}

const requestOf = ({ params, accountability, schema }: Incoming) => ({
	collection: String(params.collection),
	accountability,
	schema,
});

// The GET of /items, with the geo in the URL, as JSON (V-171), checked against the contract first, and the page as
// Directus sanitized it.
export const getItems = async (
	context: ApiExtensionContext,
	incoming: Incoming,
	engines: Engines,
): Promise<ItemsResponse> => {
	const geo = geoOf(incoming.query.geo);

	return readItems(context, { ...requestOf(incoming), geo, page: incoming.sanitizedQuery }, engines);
};

// The SEARCH of /items, with the query in the body (V-11). Directus has read the body as JSON, and the size the request
// declares and the contract come before anything else. The query of the body is read as Directus reads its own, and
// takes the place of the one of the URL (V-181).
export const searchItems = async (
	context: ApiExtensionContext,
	incoming: Incoming,
	{ pageQuery, ...engines }: Engines & { pageQuery: PageQuery },
): Promise<ItemsResponse> => {
	const search = searchOf(incoming.headers['content-length'], incoming.body);
	const page = await searchPageOf(search, incoming.sanitizedQuery, (raw) =>
		pageQuery(raw, incoming.schema, incoming.accountability),
	);

	return readItems(context, { ...requestOf(incoming), geo: search.geo, page }, engines);
};

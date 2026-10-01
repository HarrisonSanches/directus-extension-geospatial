import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Internals, Item } from 'directus-geospatial-contract';
import { databaseClientOf } from '../capabilities/detect.js';
import { knexClassOf } from '../db/client.js';
import type { PermittedQuery } from '../internals/permitted.js';
import { radiusItems } from '../operations/radius/items.js';
import { accountabilityOf, geoOf } from '../operations/request.js';

// What the route reads of a request: the collection of the path, the geo as it came, and what Directus attached to it.
export interface ItemsRequest {
	collection: string;
	geo: unknown;
	page: Query;
	accountability: Accountability | undefined;
	schema: SchemaOverview;
}

// The format of /items with the spatial operation of the geo (D-016, V-11). Directus sanitized the page as /items reads
// it, and the geo goes through the contract first, so a request off it never reaches the database.
export const readItems = (
	context: ApiExtensionContext,
	{ collection, geo, page, accountability, schema }: ItemsRequest,
	{ internals, permittedQuery }: { internals: () => Promise<Internals>; permittedQuery: PermittedQuery },
): Promise<Item[]> => {
	const radius = geoOf(geo);

	return radiusItems(
		{ collection, geo: radius, page, accountability: accountabilityOf(accountability) },
		{
			knex: context.database,
			schema,
			client: databaseClientOf(knexClassOf(context.database)),
			internals,
			permittedQuery,
			logger: context.logger.child({ extension: 'geospatial' }),
		},
	);
};

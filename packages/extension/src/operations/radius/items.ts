import { ForbiddenError, InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Database, Internals, Item, Radius } from 'directus-geospatial-contract';
import type { Logger } from 'pino';
import { failClosed } from '../../db/fail-closed.js';
import { InternalsUnsupportedError, OperationUnavailableError } from '../../errors.js';
import type { PermittedQuery } from '../../internals/permitted.js';
import { geometryFieldOf, unsupportedIn } from '../request.js';
import { radiusLevels } from './levels.js';

export interface RadiusRequest {
	collection: string;
	geo: Radius;
	// The query of the page, as Directus sanitized it for /items (V-143).
	page: Query;
	accountability: Accountability;
}

export interface Engine {
	knex: ApiExtensionContext['database'];
	schema: SchemaOverview;
	client: Database['client'];
	internals: () => Promise<Internals>;
	permittedQuery: PermittedQuery;
	logger: Pick<Logger, 'error'>;
}

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The query of the page for the chain: the limit, the offset and the page apply to the items inside the circle, so the
// permitted query goes without them, and with the fields the operation reads by their name.
const chainQueryOf = (page: Query, fields: string[]): Query => {
	const query: Query = { ...page, fields: [...(page.fields ?? ['*']), ...fields], limit: -1 };

	delete query.offset;
	delete query.page;

	return query;
};

// The window of the page over the items inside the circle, as /items reads limit, offset and page.
const windowOf = ({ limit, offset, page }: Query) => {
	const requested = limit ?? -1;
	const size = requested === -1 ? null : requested;
	const skipped = size !== null && typeof page === 'number' ? size * (page - 1) : 0;

	return { limit: size, offset: offset ?? skipped };
};

// The items of a collection within a distance of a point, out of the permitted query of whoever asks, in one SQL
// (D-001, §6, op. 1). Each check that needs no database comes first, and the database the operation does not run on
// answers so before the permitted query is built.
export const radiusItems = async (
	{ collection, geo, page, accountability }: RadiusRequest,
	{ knex, schema, client, internals, permittedQuery, logger }: Engine,
): Promise<Item[]> => {
	const unsupported = unsupportedIn(page);

	if (unsupported !== undefined) {
		throw new InvalidQueryError({ reason: `The radius does not take ${unsupported} yet` });
	}

	const checked = await internals();

	if (checked.status === 'refused') {
		throw new InternalsUnsupportedError();
	}

	const declared = radiusLevels[client];

	if (declared.level === 'unavailable') {
		throw new OperationUnavailableError({ operation: 'radius', reason: declared.reason });
	}

	// As the /items of Directus, a collection the schema does not have is refused as one the user cannot read.
	const primary = schema.collections[collection]?.primary;

	if (primary === undefined) {
		throw new ForbiddenError();
	}

	const context = { schema, knex };
	const found = geometryFieldOf(schema, collection, geo.field);

	// Whoever cannot read the collection learns nothing of its fields: the chain refuses them first.
	if ('problem' in found) {
		await permittedQuery({ collection, query: chainQueryOf(page, []), accountability }, context);

		throw new InvalidQueryError({ reason: found.problem });
	}

	// The geometry goes by its name, so a user who cannot read it gets the error of /items, instead of the field
	// quietly missing from the * (V-143).
	const { builder: permitted } = await permittedQuery(
		{ collection, query: chainQueryOf(page, [found.field]), accountability },
		context,
	);

	const { builder, itemOf } = declared.envelope(knex, {
		permitted,
		geometry: found.field,
		key: primary,
		center: geo.center,
		distance: geo.distance,
		...windowOf(page),
	});

	const rows = await failClosed(async () => {
		const result: unknown = await builder;

		return Array.isArray(result) ? result.filter(isRow) : [];
	}, logger);

	// The geometry the operation read stays out when the page did not ask for it.
	const fields = page.fields ?? ['*'];
	const asked = fields.includes('*') || fields.includes(found.field);

	return rows
		.map(itemOf)
		.map(({ [found.field]: geometry, ...item }) => (asked ? { ...item, [found.field]: geometry } : item));
};

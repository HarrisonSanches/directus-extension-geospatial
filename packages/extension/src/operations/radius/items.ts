import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Database, Internals, Item, Radius } from 'directus-geospatial-contract';
import type { Logger } from 'pino';
import { failClosed } from '../../db/fail-closed.js';
import { InternalsUnsupportedError, OperationUnavailableError } from '../../errors.js';
import type { PermittedQuery } from '../../internals/permitted.js';
import { collectionOf } from '../collection.js';
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
	// The values /items gives of the rows of a collection, as Directus reads them: a concealed field hidden, and the
	// booleans, the JSON, the CSV, the dates and the geometry converted (V-173).
	valuesOf: (collection: string, rows: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
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

// A query of the page that asks what the radius does not take yet is refused, instead of having it quietly left out:
// the one of the request, and the one the hooks of items.query returned.
const takenBy = (query: Query): Query => {
	const unsupported = unsupportedIn(query);

	if (unsupported !== undefined) {
		throw new InvalidQueryError({ reason: `The radius does not take ${unsupported} yet` });
	}

	return query;
};

// A row with the geometry in 4326 in place of the one the permitted query exposes, in the same order of the fields.
const in4326 = (row: Record<string, unknown>, geometry: string, converted: string) =>
	Object.fromEntries(
		Object.entries(row)
			.filter(([name]) => name !== converted)
			.map(([name, value]) => [name, name === geometry ? row[converted] : value]),
	);

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
	{ knex, schema, client, internals, permittedQuery, logger, valuesOf }: Engine,
): Promise<Item[]> => {
	takenBy(page);

	const checked = await internals();

	if (checked.status === 'refused') {
		throw new InternalsUnsupportedError();
	}

	const declared = radiusLevels[client];

	if (declared.level === 'unavailable') {
		throw new OperationUnavailableError({ operation: 'radius', reason: declared.reason });
	}

	const { primary } = collectionOf(schema, collection);
	const context = { schema, knex };
	const found = geometryFieldOf(schema, collection, geo.field);

	// The hooks of items.query get the page as /items hands it to them, and the radius reads the page they return
	// (V-144).
	const request = { collection, query: page, accountability };

	// Whoever cannot read the collection learns nothing of its fields: the chain refuses them first.
	if ('problem' in found) {
		await permittedQuery(request, context, (hooked) => chainQueryOf(takenBy(hooked), []));

		throw new InvalidQueryError({ reason: found.problem });
	}

	// The geometry goes by its name, so a user who cannot read it gets the error of /items, instead of the field
	// quietly missing from the * (V-143).
	const { builder: permitted, query } = await permittedQuery(request, context, (hooked) =>
		chainQueryOf(takenBy(hooked), [found.field]),
	);

	const { adapter } = declared;

	// The SRID comes from the column, never from the request, and the boxes go in it (D-007).
	const rows = await failClosed(async () => {
		const column = await adapter.columnOf(knex, collection, found.field);
		const { builder, converted } = adapter.radius(knex, {
			permitted,
			collection,
			geometry: found.field,
			column,
			boxes: await adapter.boxesIn(knex, column, geo.center, geo.distance),
			key: primary,
			center: geo.center,
			distance: geo.distance,
			...windowOf(query),
		});
		const result: unknown = await builder;
		const read = Array.isArray(result) ? result.filter(isRow) : [];

		return converted === undefined ? read : read.map((row) => in4326(row, found.field, converted));
	}, logger);

	const values = await valuesOf(collection, rows);
	const fields = query.fields ?? ['*'];

	if (fields.includes('*') || fields.includes(found.field)) {
		return values;
	}

	// The geometry the operation read stays out when the page did not ask for it.
	return values.map((item) => Object.fromEntries(Object.entries(item).filter(([name]) => name !== found.field)));
};

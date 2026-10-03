import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Database, Internals, Item, ItemsResponse, Radius } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { MeasuringAdapter, RadiusEnvelope, SelectingAdapter } from '../../db/adapter.js';
import { failClosed } from '../../db/fail-closed.js';
import { InternalsUnsupportedError, InvalidInputError, OperationUnavailableError } from '../../errors.js';
import type { PermittedQuery } from '../../internals/permitted.js';
import { limits } from '../../limits.js';
import { collectionOf } from '../collection.js';
import { geometryFieldOf, limitOf, sortOf, unsupportedIn } from '../request.js';
import type { RadiusLevel } from './levels.js';
import { distanceFrom, naturalOrderOf, pointOf } from './server.js';

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
	// The page of /items without a limit, the QUERY_LIMIT_DEFAULT of the running Directus (V-176).
	defaultLimit: number;
	// The level of the radius in each database, with its adapter (levels.ts).
	levels: Record<Database['client'], RadiusLevel>;
}

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The fields the page sorts by, which the permitted query has to expose for the list to order by them.
const sortedFieldsOf = (page: Query) => sortOf(page).map(({ field }) => field);

// The query of the page for the chain: the limit, the offset and the page apply to the items inside the circle, so the
// permitted query goes without them, and with the fields the operation reads by their name. The sort goes on, so
// Directus refuses a field the user cannot read, as /items does, and its fields are read by their name too.
const chainQueryOf = (page: Query, fields: string[]): Query => {
	const query: Query = { ...page, fields: [...(page.fields ?? ['*']), ...fields, ...sortedFieldsOf(page)], limit: -1 };

	delete query.offset;
	delete query.page;

	return query;
};

// A query of the page that asks what the radius does not take yet is refused, instead of having it quietly left out:
// the one of the request, and the one the hooks of items.query returned. A limit off the contract is too.
const takenBy = (query: Query, defaultLimit: number): Query => {
	const unsupported = unsupportedIn(query);

	if (unsupported !== undefined) {
		throw new InvalidQueryError({ reason: `The radius does not take ${unsupported} yet` });
	}

	limitOf(query, defaultLimit);

	return query;
};

// A row with the geometry in 4326 in place of the one the permitted query exposes, in the same order of the fields.
const in4326 = (row: Record<string, unknown>, geometry: string, converted: string) =>
	Object.fromEntries(
		Object.entries(row)
			.filter(([name]) => name !== converted)
			.map(([name, value]) => [name, name === geometry ? row[converted] : value]),
	);

const without = (row: Record<string, unknown>, names: string[]) =>
	Object.fromEntries(Object.entries(row).filter(([name]) => !names.includes(name)));

// The geometry the operation read, and a field it read only to order the list, which stay out when the page did not ask
// for them.
export const unaskedOf = (query: Query, geometry: string): string[] => {
	const asked = query.fields ?? ['*'];

	return asked.includes('*') ? [] : [geometry, ...sortedFieldsOf(query)].filter((field) => !asked.includes(field));
};

// The items as the radius gives them: the values of /items, without the fields the page did not ask for, and the
// distance from the center in $geo, the way Directus keeps its own values in $meta (V-13).
export const itemsOf = (values: Record<string, unknown>[], distances: unknown[], unasked: string[]): Item[] =>
	values.map((item, index) => ({ ...without(item, unasked), $geo: { distance: Number(distances[index]) } }));

// The window of the page over the items inside the circle, as /items reads limit, offset and page.
const windowOf = (query: Query, defaultLimit: number) => {
	const limit = limitOf(query, defaultLimit);
	const skipped = typeof query.page === 'number' ? limit * (query.page - 1) : 0;

	return { limit, offset: query.offset ?? skipped };
};

// The envelope of the radius, before the window of the page, which differs by who orders the list.
type Envelope = Omit<RadiusEnvelope, 'limit' | 'offset'>;

type Window = ReturnType<typeof windowOf>;

// The rows of the circle, without the values the operation calculates, the distance of each one, and whether the list
// is partial.
interface Read {
	rows: Record<string, unknown>[];
	distances: unknown[];
	capped: boolean;
}

const rowsIn = (result: unknown) => (Array.isArray(result) ? result.filter(isRow) : []);

// Where the database measures the distance: it orders and pages the list, in one statement.
const measuredByDatabase = async (knex: Knex, adapter: MeasuringAdapter, envelope: Envelope, page: Window) => {
	const { builder, distance, converted } = adapter.radius(knex, { ...envelope, ...page });
	const read = rowsIn(await builder);
	const rows = converted === undefined ? read : read.map((row) => in4326(row, envelope.geometry, converted));

	return {
		rows: rows.map((row) => without(row, [distance])),
		distances: rows.map((row) => row[distance]),
		capped: false,
	};
};

// Where the database only tells which items are inside the circle, the server measures them, from the point the
// permitted query exposes (D-051). With an order of the page, the database orders and pages the list, and the server
// measures the page. In the natural order, the database hands the rows by the primary key, one past the limit of the
// server, which measures and orders them (D-002, D-052).
const measuredByServer = async (
	knex: Knex,
	adapter: SelectingAdapter,
	envelope: Envelope,
	page: Window,
): Promise<Read> => {
	const { geometry, key, center, order } = envelope;

	if (order.length > 0) {
		const rows = rowsIn(await adapter.radius(knex, { ...envelope, ...page }).builder);

		return { rows, distances: rows.map((row) => distanceFrom(center, pointOf(row[geometry]))), capped: false };
	}

	const rows = rowsIn(await adapter.radius(knex, { ...envelope, limit: limits.server + 1, offset: 0 }).builder);

	return naturalOrderOf(rows, { geometry, key, center, ...page, cap: limits.server });
};

// The items of a collection within a distance of a point, out of the permitted query of whoever asks, in one SQL
// (D-001, §6, op. 1). Each check that needs no database comes first, and the database the operation does not run on
// answers so before the permitted query is built.
export const radiusItems = async (
	{ collection, geo, page, accountability }: RadiusRequest,
	{ knex, schema, client, internals, permittedQuery, logger, valuesOf, defaultLimit, levels }: Engine,
): Promise<ItemsResponse> => {
	takenBy(page, defaultLimit);

	const checked = await internals();

	if (checked.status === 'refused') {
		throw new InternalsUnsupportedError();
	}

	const declared = levels[client];

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
		await permittedQuery(request, context, (hooked) => chainQueryOf(takenBy(hooked, defaultLimit), []));

		throw new InvalidInputError({ reason: found.problem });
	}

	// The geometry goes by its name, so a user who cannot read it gets the error of /items, instead of the field
	// quietly missing from the * (V-143).
	const { builder: permitted, query } = await permittedQuery(request, context, (hooked) =>
		chainQueryOf(takenBy(hooked, defaultLimit), [found.field]),
	);

	// The SRID comes from the column, never from the request, and the boxes go in it (D-007).
	const { rows, distances, capped } = await failClosed(async (): Promise<Read> => {
		// A geometry the database in use does not measure, past the chain, which refuses first whoever cannot read the
		// collection or the field (D-052).
		if (declared.level === 'capped' && !(await declared.adapter.measures(knex, collection, found.field))) {
			throw new OperationUnavailableError({
				operation: 'radius',
				reason: 'It only measures points on the database in use.',
			});
		}

		const { adapter } = declared;
		const column = await adapter.columnOf(knex, collection, found.field);
		const envelope: Envelope = {
			permitted,
			collection,
			geometry: found.field,
			column,
			boxes: await adapter.boxesIn(knex, column, geo.center, geo.distance),
			key: primary,
			center: geo.center,
			distance: geo.distance,
			order: sortOf(query),
		};
		const page = windowOf(query, defaultLimit);

		return declared.level === 'capped'
			? measuredByServer(knex, declared.adapter, envelope, page)
			: measuredByDatabase(knex, declared.adapter, envelope, page);
	}, logger);

	const values = await valuesOf(collection, rows);
	const data = itemsOf(values, distances, unaskedOf(query, found.field));

	return capped ? { data, meta: { capped: { limit: limits.server } } } : { data };
};

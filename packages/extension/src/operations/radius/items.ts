import { InvalidQueryError } from '@directus/errors';
import type { Accountability, ApiExtensionContext, Query, SchemaOverview } from '@directus/types';
import type { Database, Internals, Item, ItemsResponse, Radius } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { Key, MeasuringAdapter, RadiusEnvelope, SelectingAdapter } from '../../db/adapter.js';
import { failClosed } from '../../db/fail-closed.js';
import { InternalsUnsupportedError, InvalidInputError, OperationUnavailableError } from '../../errors.js';
import type { PermittedQuery } from '../../internals/permitted.js';
import { limits } from '../../limits.js';
import { afterOf, cursorOf, type List } from '../../query/cursor.js';
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
	// Where the page starts, by the cursor the page before brought, or undefined, for the first page (D-054).
	cursor?: string;
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
	// The key of the cursors (query/key.ts).
	cursorKey: Buffer;
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

// The window of the page over the items inside the circle, as /items reads limit, offset and page, or right after the
// item of the cursor. It reads one item past the page, which tells whether a next page exists.
const windowOf = (query: Query, defaultLimit: number, after: Key[] | undefined) => {
	const limit = limitOf(query, defaultLimit) + 1;

	if (after !== undefined) {
		return { limit, offset: 0, after };
	}

	const skipped = typeof query.page === 'number' ? (limit - 1) * (query.page - 1) : 0;

	return { limit, offset: query.offset ?? skipped };
};

// The list a cursor of the request belongs to: the collection, the operation and the order the request asks (D-054).
const listOf = (collection: string, geo: Radius, page: Query): List => ({ collection, geo, sort: page.sort ?? [] });

// The values of the order of the last item the page before saw, out of the cursor of the request, which does not go
// with an offset or a page. A cursor changed or of another list is refused here, before anything reaches the database.
const afterIn = (cursor: string | undefined, page: Query, key: Buffer, list: List): Key[] | undefined => {
	if (cursor === undefined) {
		return undefined;
	}

	if (page.offset !== undefined || page.page !== undefined) {
		throw new InvalidQueryError({ reason: 'The cursor does not go with the offset or the page' });
	}

	return afterOf(key, list, cursor);
};

// A value of the order of a row, as the column the adapter names brought it: the text of Postgres, and the number, the
// text or the empty value of SQLite.
const keyIn = (value: unknown): Key => (typeof value === 'number' || typeof value === 'string' ? value : null);

// The cursor of the page after the one shown, from the order of its last item, where the database read one item past
// the page.
const nextOf = (keys: Key[][], shown: number, seal: (last: Key[]) => string): string | undefined => {
	const [last, beyond] = keys.slice(shown - 1, shown + 1);

	return beyond === undefined || last === undefined ? undefined : seal(last);
};

// The envelope of the radius, before the window of the page, which differs by who orders the list.
type Envelope = Omit<RadiusEnvelope, 'limit' | 'offset'>;

type Window = ReturnType<typeof windowOf>;

// The rows of the circle, without the values the operation calculates, the distance and the order of each one, and
// whether the list is partial.
interface Read {
	rows: Record<string, unknown>[];
	distances: unknown[];
	keys: Key[][];
	capped: boolean;
}

const rowsIn = (result: unknown) => (Array.isArray(result) ? result.filter(isRow) : []);

// Where the database measures the distance: it orders and pages the list, in one statement.
const measuredByDatabase = async (
	knex: Knex,
	adapter: MeasuringAdapter,
	envelope: Envelope,
	page: Window,
): Promise<Read> => {
	const { builder, distance, converted, keys } = adapter.radius(knex, { ...envelope, ...page });
	const read = rowsIn(await builder);
	const rows = converted === undefined ? read : read.map((row) => in4326(row, envelope.geometry, converted));

	return {
		rows: rows.map((row) => without(row, [distance, ...keys])),
		distances: rows.map((row) => row[distance]),
		keys: rows.map((row) => keys.map((name) => keyIn(row[name]))),
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
		const { builder, keys } = adapter.radius(knex, { ...envelope, ...page });
		const rows = rowsIn(await builder);

		return {
			rows: rows.map((row) => without(row, keys)),
			distances: rows.map((row) => distanceFrom(center, pointOf(row[geometry]))),
			keys: rows.map((row) => keys.map((name) => keyIn(row[name]))),
			capped: false,
		};
	}

	const rows = rowsIn(await adapter.radius(knex, { ...envelope, limit: limits.server + 1, offset: 0 }).builder);
	const ordered = await naturalOrderOf(rows, { geometry, key, center, ...page, cap: limits.server });

	return {
		...ordered,
		keys: ordered.rows.map((row, index) => [Number(ordered.distances[index]), keyIn(row[key])]),
	};
};

// The items of a collection within a distance of a point, out of the permitted query of whoever asks, in one SQL
// (D-001, §6, op. 1). Each check that needs no database comes first, and the database the operation does not run on
// answers so before the permitted query is built.
export const radiusItems = async (
	{ collection, geo, page, accountability, cursor }: RadiusRequest,
	{ knex, schema, client, internals, permittedQuery, logger, valuesOf, defaultLimit, levels, cursorKey }: Engine,
): Promise<ItemsResponse> => {
	takenBy(page, defaultLimit);

	const list = listOf(collection, geo, page);
	const after = afterIn(cursor, page, cursorKey, list);

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

	const order = sortOf(query);

	// The cursor holds the order of an item: the distance and the key in the natural order, or the fields of the sort
	// and the key. One that does not match the order the hooks returned is refused, before the database.
	if (after !== undefined && after.length !== (order.length === 0 ? 2 : order.length + 1)) {
		throw new InvalidInputError({ reason: 'The cursor is not one this list gave' });
	}

	// The SRID comes from the column, never from the request, and the boxes go in it (D-007).
	const { rows, distances, keys, capped } = await failClosed(async (): Promise<Read> => {
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
			order,
		};
		const page = windowOf(query, defaultLimit, after);

		return declared.level === 'capped'
			? measuredByServer(knex, declared.adapter, envelope, page)
			: measuredByDatabase(knex, declared.adapter, envelope, page);
	}, logger);

	const shown = limitOf(query, defaultLimit);
	const values = await valuesOf(collection, rows.slice(0, shown));
	const data = itemsOf(values, distances.slice(0, shown), unaskedOf(query, found.field));
	const next = nextOf(keys, shown, (last) => cursorOf(cursorKey, list, last));
	const meta = { ...(capped && { capped: { limit: limits.server } }), ...(next !== undefined && { next }) };

	return capped || next !== undefined ? { data, meta } : { data };
};

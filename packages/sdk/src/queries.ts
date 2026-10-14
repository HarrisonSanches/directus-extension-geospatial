import {
	type ApplyQueryFields,
	type CollectionType,
	formatFields,
	type Prettify,
	type Query,
	type RegularCollections,
	type RestCommand,
	throwIfEmpty,
} from '@directus/sdk';
import {
	type Cursor,
	type GeoValues,
	type Item,
	type ItemsMeta,
	type Position,
	type QueryId,
	type Shapes,
	type SummaryValues,
	wholeBodyType,
} from 'directus-geospatial-contract';
import { wholeBodyOf } from './whole-body.js';

// The radius of a question, with the geometry field typed by the item.
export interface GeoRadiusOperation<Item> {
	readonly operation: 'radius';
	// The geometry field, which may be left out when the collection has a single one.
	readonly field?: Extract<keyof Item, string>;
	// [longitude, latitude], in WGS 84.
	readonly center: Readonly<Position>;
	// In meters, over the ellipsoid.
	readonly distance: number;
}

// The question of a registered query (D-004): the spatial operation, and the filter, the search and the fields of
// /items, typed by the schema of the project, as readItems types them. The page goes in the command of each part.
export type GeoQuestion<Schema, Item> = Pick<Query<Schema, Item>, 'fields' | 'filter' | 'search'> & {
	readonly geo: GeoRadiusOperation<Item>;
};

declare const question: unique symbol;

// A registered query, by the id its registration gave. For the types only, it carries the collection and the fields of
// its question, so the command of each part types what it gives. An id on its own, as a link brings it, also goes.
export interface GeoQuery<Schema = unknown, Collection = unknown, Fields = unknown> {
	readonly id: QueryId;
	readonly [question]?: { schema: Schema; collection: Collection; fields: Fields };
}

// The page of a part, which goes in the URL: how many, and where it starts, as the meta.next of the page before brings
// it. The items also take the sort of /items.
export interface GeoQueryPage {
	readonly limit?: number;
	readonly cursor?: Cursor;
}

export type GeoQueryItemsPage<Schema, Collection> = GeoQueryPage &
	(Collection extends RegularCollections<Schema>
		? Pick<Query<Schema, CollectionType<Schema, Collection>>, 'sort'>
		: { readonly sort?: string | readonly string[] });

// An item of a registered query: the fields of its question, typed as readItems types them, and the values of the
// operation in $geo. Without the types of the registration, the item of the contract.
export type GeoQueryItem<Schema, Collection, Fields> =
	Collection extends RegularCollections<Schema>
		? Prettify<ApplyQueryFields<Schema, CollectionType<Schema, Collection>, Fields> & { $geo: GeoValues }>
		: Item;

// The items and the meta of the list: the cursor of the next page, and the capped of a list the server of the
// extension could only order in part (D-052).
export interface GeoQueryItemsOutput<Schema, Collection, Fields> {
	data: GeoQueryItem<Schema, Collection, Fields>[];
	meta?: ItemsMeta;
}

// A field of a question, by its name or as the fields of a relation, as readItems takes them.
const isField = (field: unknown): field is string | Record<string, unknown> =>
	typeof field === 'string' || (typeof field === 'object' && field !== null);

// The path of a part of a registered query, with its id escaped.
const pathOf = (query: GeoQuery | QueryId, part: 'items' | 'shapes' | 'summary') => {
	const id = typeof query === 'string' ? query : query.id;

	throwIfEmpty(id, 'Query id cannot be empty');

	return `/geospatial/queries/${encodeURIComponent(id)}/${part}`;
};

// Registers the question of a query, and gives the query, by its id, which the command of each part reads (D-004). The
// same question gets the same id, so registering it again, after Directus forgot it, brings the same query back. The
// fields go as a list, as Directus reads them in a body, with those of a relation by their path, as readItems sends
// them.
export const geoRegisterQuery =
	<
		Schema,
		Collection extends RegularCollections<Schema>,
		const TQuestion extends GeoQuestion<Schema, CollectionType<Schema, Collection>>,
	>(
		collection: Collection,
		asked: TQuestion,
	): RestCommand<GeoQuery<Schema, Collection, TQuestion['fields']>, Schema> =>
	() => {
		throwIfEmpty(String(collection), 'Collection cannot be empty');

		const { geo, fields, filter, search } = asked;
		const query = {
			...(fields !== undefined && { fields: formatFields(fields.filter(isField)) }),
			...(filter !== undefined && { filter }),
			...(search !== undefined && { search }),
		};

		return {
			path: '/geospatial/queries',
			method: 'POST',
			body: JSON.stringify({ collection, geo, ...(Object.keys(query).length > 0 && { query }) }),
		};
	};

// The items of a registered query, with the permissions of whoever asks (D-022). It asks for the media type of the
// extension, whose body the request of the Directus SDK hands over whole, so the meta comes with the items (D-058).
export const geoQueryItems =
	<Schema, Collection = unknown, Fields = unknown>(
		query: GeoQuery<Schema, Collection, Fields> | QueryId,
		page?: GeoQueryItemsPage<Schema, Collection>,
	): RestCommand<GeoQueryItemsOutput<Schema, Collection, Fields>, Schema> =>
	() => ({
		path: pathOf(query, 'items'),
		params: { ...page },
		method: 'GET',
		headers: { Accept: wholeBodyType },
		onResponse: wholeBodyOf,
	});

// The shapes of a registered query, in GeoJSON, with the meta, as the items (D-022): for the radius, the circle.
export const geoQueryShapes =
	<Schema>(query: GeoQuery<Schema> | QueryId, page?: GeoQueryPage): RestCommand<Shapes, Schema> =>
	() => ({
		path: pathOf(query, 'shapes'),
		params: { ...page },
		method: 'GET',
		headers: { Accept: wholeBodyType },
		onResponse: wholeBodyOf,
	});

// The summary of a registered query, the total in two times (§7.1): exact up to 10,000 items, and past that a floor,
// with counting while the exact count runs in the background. geoFinalSummary() waits for it.
export const geoQuerySummary =
	<Schema>(query: GeoQuery<Schema> | QueryId): RestCommand<SummaryValues, Schema> =>
	() => ({ path: pathOf(query, 'summary'), method: 'GET' });

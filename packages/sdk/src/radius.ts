import {
	type ApplyQueryFields,
	type CollectionType,
	type Prettify,
	type Query,
	type RegularCollections,
	type RestCommand,
	throwIfEmpty,
} from '@directus/sdk';
import {
	type Cursor,
	type GeoValues,
	type ItemsMeta,
	type Position,
	wholeBodyType,
} from 'directus-geospatial-contract';

// The radius, and the page of /items the route takes (D-016): the fields, the filter, the search and the sort typed by
// the schema of the project, as readItems types them.
export type GeoRadiusQuery<Schema, Item> = Pick<
	Query<Schema, Item>,
	'fields' | 'filter' | 'search' | 'sort' | 'limit' | 'offset' | 'page'
> & {
	// The geometry field, which may be left out when the collection has a single one.
	readonly field?: Extract<keyof Item, string>;
	// [longitude, latitude], in WGS 84.
	readonly center: Readonly<Position>;
	// In meters, over the ellipsoid.
	readonly distance: number;
	// Where the page starts, as the meta.next of the page before brings it.
	readonly cursor?: Cursor;
};

// An item of the radius: the fields the query asks for, typed as readItems types them, and the distance in $geo.
export type GeoRadiusItem<
	Schema,
	Collection extends RegularCollections<Schema>,
	TQuery extends GeoRadiusQuery<Schema, CollectionType<Schema, Collection>>,
> = Prettify<ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery['fields']> & { $geo: GeoValues }>;

// The items and the meta of the list: the cursor of the next page, and the capped of a list the server of the
// extension could only order in part (D-052).
export interface GeoRadiusOutput<
	Schema,
	Collection extends RegularCollections<Schema>,
	TQuery extends GeoRadiusQuery<Schema, CollectionType<Schema, Collection>>,
> {
	data: GeoRadiusItem<Schema, Collection, TQuery>[];
	meta?: ItemsMeta;
}

// Whether the request of the Directus SDK handed over the response itself, as it does when the response comes as a
// media type other than application/json, the way it checks one.
const isResponse = (value: unknown): value is Response =>
	typeof value === 'object' && value !== null && 'json' in value && typeof value.json === 'function';

// The whole body of a list, the meta included (D-058). The request of the Directus SDK hands over the response itself
// when it comes as the media type of the extension, and only the data when it comes as application/json, as an
// extension older than the SDK answers.
const wholeBodyOf = async (response: unknown): Promise<unknown> =>
	isResponse(response) ? response.json() : { data: response };

// The items of a collection within a distance of a point, in the format of /items (D-016), with the permissions of
// whoever asks. It asks for the media type of the extension, whose body the request of the Directus SDK hands over
// whole, so the meta comes with the items.
export const geoRadius =
	<
		Schema,
		Collection extends RegularCollections<Schema>,
		const TQuery extends GeoRadiusQuery<Schema, CollectionType<Schema, Collection>>,
	>(
		collection: Collection,
		query: TQuery,
	): RestCommand<GeoRadiusOutput<Schema, Collection, TQuery>, Schema> =>
	() => {
		throwIfEmpty(String(collection), 'Collection cannot be empty');

		const { field, center, distance, ...page } = query;

		return {
			path: `/geospatial/items/${String(collection)}`,
			params: { ...page, geo: { operation: 'radius', ...(field !== undefined && { field }), center, distance } },
			method: 'GET',
			headers: { Accept: wholeBodyType },
			onResponse: wholeBodyOf,
		};
	};

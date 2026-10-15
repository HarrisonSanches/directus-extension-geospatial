---
title: Radius
description: The items of a collection within a distance of a point, through the API and the SDK.
---

The radius gives the items of a collection within a distance of a point, in meters over the ellipsoid. An item is inside
when any part of it is at most at that distance, the edge included.

It answers with the permissions of whoever asks: the items come out of the query Directus builds of what the user can
read, so a user only ever receives the items `/items` would give them, and gets the same errors.

## With the API

The route takes the query of `/items`, with the spatial operation in the parameter `geo`, as JSON, the way Directus
takes the filter.

```bash
curl --get "$DIRECTUS_URL/geospatial/items/occurrences" \
  --header "Authorization: Bearer $TOKEN" \
  --data-urlencode 'geo={"operation":"radius","field":"location","center":[-46.6333,-23.5505],"distance":1500}' \
  --data-urlencode 'fields=id,category' \
  --data-urlencode 'limit=2'
```

- `field` is the geometry field, and may be left out when the collection has a single one.
- `center` is `[longitude, latitude]`, in WGS 84, and `distance` is in meters.

Each item brings its distance to the center in `$geo`, and the list comes nearest first, unless the query has a `sort`.
The `meta.next` is the cursor of the next page, which goes in the parameter `cursor`, and is missing on the last page.

```json
{
	"data": [
		{ "id": 7, "category": "theft", "$geo": { "distance": 112.4 } },
		{ "id": 3, "category": "noise", "$geo": { "distance": 486.9 } }
	],
	"meta": { "next": "kq1Xh0b0JxW6l2bG7l1bq3AfZt8yNw" }
}
```

The `limit` goes from 1 to 1,000, and without it the page has the default size of Directus. A query too long for a URL
goes in the body, with the [`SEARCH` method](/api/#geospatial/searchItems). Every parameter is in the
[reference of the route](/api/#geospatial/items).

On SQLite, with SpatiaLite, the radius reads only points, and the extension orders up to 50,000 items. Past that, the
`meta` has `capped`, which says the list is partial.

## With the SDK

The SDK, `directus-geospatial-sdk`, gives commands for the client of the Directus SDK, as `readItems` is, with the fields
typed by the schema of the project.

```ts
import { createDirectus, rest, staticToken } from '@directus/sdk';
import { geoPaginate, geoRadius, isGeospatialError } from 'directus-geospatial-sdk';

interface Schema {
	occurrences: { id: number; category: string; location: { type: 'Point'; coordinates: [number, number] } }[];
}

const client = createDirectus<Schema>('https://directus.example.com').with(rest()).with(staticToken('your-token'));

const radius = geoRadius('occurrences', {
	field: 'location',
	center: [-46.6333, -23.5505],
	distance: 1500,
	fields: ['id', 'category'],
});

try {
	const { data, meta } = await client.request(radius);

	console.log(data[0]?.category, data[0]?.$geo.distance, meta?.next);
} catch (error) {
	if (isGeospatialError(error, 'GEOSPATIAL_OPERATION_UNAVAILABLE')) {
		// The database of this Directus does not run the radius.
	}
}
```

`geoRadius()` gives `{ data, meta }`, and not only the items, as `readItems` does: the client of the Directus SDK hands
over only the `data` of an `application/json` response, so the command asks for the list in the media type of the
extension, `application/vnd.directus-geospatial+json`, which has the same body.

`geoPaginate()` reads every page, one at a time, following the `meta.next` of each:

```ts
for await (const { data } of geoPaginate(client, radius)) {
	console.log(data.length);
}
```

`isGeospatialError()` tells an error of the API apart and types its code: one of the extension, which starts with
`GEOSPATIAL_`, or one of Directus, such as `FORBIDDEN`.

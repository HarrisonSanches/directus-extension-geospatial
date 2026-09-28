import { defineHook } from '@directus/extensions-sdk';
import type { EventContext, Query } from '@directus/types';
import { record } from './calls.js';

// The collection of this extension, which the spikes create, and whose query the hook leaves with the open occurrences.
const collection = 'hooked_occurrences';

// What Directus hands to a filter on items.query: the event, as it matched the listener, and the collection.
const callOf = (query: Query, meta: Record<string, unknown>, { accountability }: EventContext) => ({
	event: typeof meta.event === 'string' ? meta.event : '',
	collection: typeof meta.collection === 'string' ? meta.collection : '',
	query,
	accountability,
});

// A hook of another extension, as a user of the extension could install beside it (F01-04).
export default defineHook(({ filter }) => {
	// The query of every collection, which the hook only records, to compare what the radius and the /items hand over.
	filter<Query>('items.query', (query, meta, context) => {
		record(callOf(query, meta, context));

		return query;
	});

	// The query of its own collection only, by the scoped event.
	filter<Query>(`${collection}.items.query`, (query, meta, context) => {
		record(callOf(query, meta, context));

		return { ...query, filter: { _and: [...(query.filter ? [query.filter] : []), { status: { _eq: 'open' } }] } };
	});
});

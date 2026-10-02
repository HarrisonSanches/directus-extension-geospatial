import { defineHook } from '@directus/extensions-sdk';
import type { EventContext, Query } from '@directus/types';
import { collection, record } from './calls.js';

// What Directus hands to a filter on items.query: the event, as it matched the filter, and the collection.
const callOf = (query: Query, meta: Record<string, unknown>, { accountability }: EventContext) => ({
	event: typeof meta.event === 'string' ? meta.event : '',
	collection: typeof meta.collection === 'string' ? meta.collection : '',
	query,
	accountability,
});

// The hooks of another extension, as a user of the extension could install beside it, which the radius respects as
// /items does (§5, perdas aceitas, V-144).
export default defineHook(({ filter }) => {
	// The query of every collection, of which the hook records the reads of its own collection, to compare what the radius
	// and /items hand over.
	filter<Query>('items.query', (query, meta, context) => {
		if (meta.collection === collection) {
			record(callOf(query, meta, context));
		}

		return query;
	});

	// The query of its own collection only, by the event of the collection, which leaves only the open occurrences.
	filter<Query>(`${collection}.items.query`, (query, meta, context) => {
		record(callOf(query, meta, context));

		return { ...query, filter: { _and: [...(query.filter ? [query.filter] : []), { status: { _eq: 'open' } }] } };
	});
});

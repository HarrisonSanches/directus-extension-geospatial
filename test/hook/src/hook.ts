import { defineHook } from '@directus/extensions-sdk';
import type { EventContext, Query } from '@directus/types';
import { collection, record, recordRead } from './calls.js';

// What Directus hands to a filter on items.query: the event, as it matched the filter, and the collection.
const callOf = (query: Query, meta: Record<string, unknown>, { accountability }: EventContext) => ({
	event: typeof meta.event === 'string' ? meta.event : '',
	collection: typeof meta.collection === 'string' ? meta.collection : '',
	query,
	accountability,
});

const textOf = (value: unknown) => (typeof value === 'string' ? value : '');

// The hooks of another extension, as a user of the extension could install beside it, which the radius respects as
// /items does (§5, perdas aceitas, V-144).
export default defineHook(({ filter, action }) => {
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

	// The items read of its own collection, whose region it hides, as a hook that hides a value from some users would
	// (A-045).
	filter<Record<string, unknown>[]>(`${collection}.items.read`, (items, meta, { accountability }) => {
		recordRead({
			kind: 'filter',
			event: textOf(meta.event),
			collection: textOf(meta.collection),
			query: meta.query as Query,
			accountability,
			payload: items,
		});

		return items.map((item) => ('region' in item ? { ...item, region: 'hidden' } : item));
	});

	// What the actions of items.read get on its own collection, after the filters.
	action(`${collection}.items.read`, (meta, { accountability }) => {
		recordRead({
			kind: 'action',
			event: textOf(meta.event),
			collection: textOf(meta.collection),
			query: meta.query as Query,
			accountability,
			payload: meta.payload,
		});
	});
});

import type { Accountability, Query } from '@directus/types';

// The collection of this extension, which the suite creates, and the only one whose reads the hooks record and change.
export const collection = 'hooked_occurrences';

// What a hook of this extension received on one items.query event.
export interface Call {
	event: string;
	collection: string;
	query: Query;
	accountability: Accountability | null;
}

const calls: Call[] = [];

// A copy, since Directus goes on reading and changing the same query after the hooks.
export const record = (call: Call): void => {
	calls.push(structuredClone(call));
};

// The calls since the last take, in the order they came, forgotten once handed over.
export const take = (): Call[] => calls.splice(0);

// What a hook of this extension received on one items.read event: the filter, with the items as they came, before it
// hides the region, and the action, with what the filters returned.
export interface Read {
	kind: 'filter' | 'action';
	event: string;
	collection: string;
	query: Query;
	accountability: Accountability | null;
	payload: unknown;
}

const reads: Read[] = [];

export const recordRead = (read: Read): void => {
	reads.push(structuredClone(read));
};

export const takeReads = (): Read[] => reads.splice(0);

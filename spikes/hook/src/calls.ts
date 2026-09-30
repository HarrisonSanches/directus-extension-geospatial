import type { Accountability, Query } from '@directus/types';

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

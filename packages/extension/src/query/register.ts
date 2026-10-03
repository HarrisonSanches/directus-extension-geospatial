import { InvalidQueryError } from '@directus/errors';
import type { Query } from '@directus/types';
import type { RegisteredQuery } from 'directus-geospatial-contract';
import { UnknownQueryError } from '../errors.js';
import { idOf } from './id.js';
import { pinnedNow } from './now.js';
import type { Registry } from './registry.js';

interface Registering {
	registry: Registry;
	// The key of the ids of the installation (id.ts).
	key: Buffer;
	// The clock, in milliseconds.
	now: () => number;
	// The query of /items as Directus reads it in a body, for whoever registers, which refuses one off its rules (V-181).
	read: (raw: Record<string, unknown>) => Promise<unknown>;
}

// The question with each $NOW of its filter resolved to the minute of the registration (D-031).
const pinnedAt = (question: RegisteredQuery, at: number): RegisteredQuery => {
	const { query } = question;

	return query?.filter === undefined
		? question
		: { ...question, query: { ...query, filter: pinnedNow(query.filter, at) } };
};

// Registers a question, and returns its id (D-004). The query goes through Directus first, so a question it would refuse
// never gets an id. No permission applies here, and the collection is not looked up, so registering tells nothing of
// what the schema holds: each part applies the permissions of whoever asks it.
export const register = async (
	question: RegisteredQuery,
	{ registry, key, now, read }: Registering,
): Promise<string> => {
	const registered = pinnedAt(question, now());

	if (registered.query !== undefined) {
		await read(registered.query);
	}

	const id = idOf(key, registered);

	await registry.put(id, registered);

	return id;
};

// The question of an id, or the error that has the client register it again (§7.8).
export const questionOf = async (registry: Registry, id: string): Promise<RegisteredQuery> => {
	const question = await registry.get(id);

	if (question === undefined) {
		throw new UnknownQueryError();
	}

	return question;
};

// The parameters of /items the URL of a part takes: the page of the part. Directus adds the fields * to the query of every
// URL, so they count only when the URL brings them.
const ofThePart = new Set(['limit', 'sort', 'fields']);

// The page of a part: the query of the question, as Directus reads it for whoever asks, which resolves the variables of
// the filter for them, with the limit and the sort of the URL. Another parameter of /items in the URL belongs to the
// registration, and is refused, instead of having it quietly left out.
export const pageOfPart = async (
	{ query }: RegisteredQuery,
	url: { page: Query; raw: Record<string, unknown> },
	read: (raw: Record<string, unknown>) => Promise<Query>,
): Promise<Query> => {
	if (url.raw.fields !== undefined || Object.keys(url.page).some((name) => !ofThePart.has(name))) {
		throw new InvalidQueryError({
			reason: 'The URL of a part takes only the limit and the sort, and the rest of the query goes in its registration',
		});
	}

	const { limit, sort } = url.page;

	return {
		...(await read(query ?? {})),
		...(limit === undefined ? {} : { limit }),
		...(sort === undefined ? {} : { sort }),
	};
};

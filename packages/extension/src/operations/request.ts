import { ForbiddenError, InvalidQueryError } from '@directus/errors';
import type { Accountability, Query, SchemaOverview } from '@directus/types';
import {
	type Cursor,
	type Geo,
	type ItemsSearch,
	type Limit,
	openapi,
	type QueryId,
	type RegisteredQuery,
} from 'directus-geospatial-contract';
import { type Checked, inputsOf } from 'directus-geospatial-contract/requests';
import { InvalidInputError, LimitExceededError } from '../errors.js';
import { limits } from '../limits.js';

const inputs = inputsOf(openapi);
const checkGeo = inputs.schema<Geo>('Geo');
const checkSearch = inputs.schema<ItemsSearch>('ItemsSearch');
const checkLimit = inputs.schema<Limit>('Limit');
const checkRegistered = inputs.schema<RegisteredQuery>('RegisteredQuery');
const checkQueryId = inputs.schema<QueryId>('QueryId');
const checkCursor = inputs.schema<Cursor>('Cursor');

// The geo of a request, as JSON, the way Directus takes the filter and its SDK sends a parameter it does not know
// (V-171), checked against the contract before anything reaches the database (D-016).
export const geoOf = (raw: unknown): Geo => {
	if (raw === undefined) {
		throw new InvalidInputError({ reason: 'The geo parameter is required' });
	}

	if (typeof raw !== 'string') {
		throw new InvalidInputError({ reason: 'The geo parameter goes as JSON' });
	}

	let value: unknown;

	try {
		value = JSON.parse(raw);
	} catch {
		throw new InvalidInputError({ reason: 'The geo parameter is not valid JSON' });
	}

	const checked = checkGeo(value);

	if (!checked.valid) {
		throw new InvalidInputError({ reason: `The geo parameter is off the contract: ${checked.errors.join(', ')}` });
	}

	return checked.value;
};

// A body, which Directus has already read as JSON, up to its own limit (V-10): the size first, by the Content-Length the
// request declares, or by the body read, when the request comes in chunks, and then the contract.
const bodyOf =
	<T>(check: (value: unknown) => Checked<T>) =>
	(contentLength: string | string[] | undefined, body: unknown): T => {
		const size =
			typeof contentLength === 'string' ? Number(contentLength) : Buffer.byteLength(JSON.stringify(body ?? null));

		if (size > limits.body) {
			throw new LimitExceededError({ limit: limits.body });
		}

		const checked = check(body);

		if (!checked.valid) {
			throw new InvalidInputError({ reason: `The body is off the contract: ${checked.errors.join(', ')}` });
		}

		return checked.value;
	};

// The body of a SEARCH: the geo, and the query of /items.
export const searchOf = bodyOf(checkSearch);

// The body of the registration of a query: the whole question (D-004).
export const registeredQueryOf = bodyOf(checkRegistered);

// The cursor of the URL, where a page starts, checked against the contract, or undefined, for the first page. What it
// holds is checked by the operation, still before the database (D-054).
export const cursorIn = (raw: unknown): Cursor | undefined => {
	if (raw === undefined) {
		return undefined;
	}

	const checked = checkCursor(raw);

	if (!checked.valid) {
		throw new InvalidInputError({ reason: `The cursor is off the contract: ${checked.errors.join(', ')}` });
	}

	return checked.value;
};

// The cursor of a SEARCH: the one of the body, or in its place the one of the URL, as the query of the body takes the
// place of the one of the URL.
export const searchCursorOf = ({ cursor }: ItemsSearch, raw: unknown): Cursor | undefined => cursor ?? cursorIn(raw);

// The id of a registered query in the URL, checked against the contract before the registry is looked up.
export const queryIdOf = (raw: string): QueryId => {
	const checked = checkQueryId(raw);

	if (!checked.valid) {
		throw new InvalidInputError({ reason: `The id is off the contract: ${checked.errors.join(', ')}` });
	}

	return checked.value;
};

// The page of a SEARCH: the query of its body, which Directus reads as it reads its own, in place of the one of the URL,
// or the one of the URL, when the body brings none (V-181).
export const searchPageOf = (
	{ query }: ItemsSearch,
	urlPage: Query,
	read: (raw: Record<string, unknown>) => Promise<Query>,
): Promise<Query> => (query === undefined ? Promise.resolve(urlPage) : read(query));

// The parameters of /items that change what comes back and that the operations do not take yet. A request with one
// is refused, instead of having it quietly left out.
const notYet = ['aggregate', 'group', 'deep', 'alias', 'backlink', 'version', 'export'] as const;

// The field of an entry of the sort, without the minus of the descending order.
const sortedField = (entry: string) => (entry.startsWith('-') ? entry.slice(1) : entry);

// The first parameter of the page the operations do not take yet, or undefined. The query of the operation reads one
// level, so the fields of a relation would come back as their keys, and not as /items gives them, and the list orders
// by the fields the query exposes, which a relation or a function is not.
export const unsupportedIn = (page: Query): string | undefined => {
	const sorted = (page.sort ?? []).map(sortedField);

	return (
		notYet.find((parameter) => page[parameter] !== undefined) ??
		(page.fields?.some((field) => field.includes('.')) === true ? 'fields of a relation' : undefined) ??
		(sorted.some((field) => field.includes('.')) ? 'sort by a relation' : undefined) ??
		(sorted.some((field) => field.includes('(')) ? 'sort by a function' : undefined)
	);
};

// The order the page asks, field by field, as /items reads its sort, or none, for the natural order of the operation.
export const sortOf = ({ sort }: Query): { field: string; direction: 'asc' | 'desc' }[] =>
	(sort ?? []).map((entry) => ({ field: sortedField(entry), direction: entry.startsWith('-') ? 'desc' : 'asc' }));

// How many items the page brings: the limit of the request, inside the contract, or else the default page of Directus,
// its QUERY_LIMIT_DEFAULT, which never goes past the maximum (A-044). /items brings every item for a limit of -1, which
// the contract refuses: past the maximum, the items come by the next pages.
export const limitOf = ({ limit }: Query, defaultLimit: number): number => {
	if (limit === undefined) {
		return Math.min(defaultLimit, limits.page);
	}

	const checked = checkLimit(limit);

	if (!checked.valid) {
		throw new InvalidQueryError({ reason: `The limit is off the contract: ${checked.errors.join(', ')}` });
	}

	return checked.value;
};

const isGeometry = (type: string) => type === 'geometry' || type.startsWith('geometry.');

// The geometry field an operation reads: the one the request names, or the only one of the collection. A field the
// schema does not have goes on to the chain of Directus, which refuses it as /items does.
export const geometryFieldOf = (
	schema: SchemaOverview,
	collection: string,
	field: string | undefined,
): { field: string } | { problem: string } => {
	const fields = Object.values(schema.collections[collection]?.fields ?? {});

	if (field !== undefined) {
		const known = fields.find((candidate) => candidate.field === field);

		return known === undefined || isGeometry(known.type)
			? { field }
			: { problem: `The field ${field} of ${collection} is not a geometry` };
	}

	const geometries = fields.filter(({ type }) => isGeometry(type));
	const [only, ...others] = geometries;

	if (only === undefined) {
		return { problem: `The collection ${collection} has no geometry field` };
	}

	if (others.length > 0) {
		return {
			problem: `The collection ${collection} has ${String(geometries.length)} geometry fields, so the geo names one in field`,
		};
	}

	return { field: only.field };
};

// The accountability Directus attaches to every request, the public one included. The chain reads a null one as
// Directus reading for itself, with no permission at all, so a request that came without one is refused, instead of
// reading as that (D-001).
export const accountabilityOf = (accountability: Accountability | undefined): Accountability => {
	if (accountability === undefined) {
		throw new ForbiddenError();
	}

	return accountability;
};

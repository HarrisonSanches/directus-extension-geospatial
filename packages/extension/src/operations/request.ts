import { ForbiddenError, InvalidQueryError } from '@directus/errors';
import type { Accountability, Query, SchemaOverview } from '@directus/types';
import { type Geo, openapi } from 'directus-geospatial-contract';
import { inputsOf } from 'directus-geospatial-contract/requests';

const checkGeo = inputsOf(openapi).schema<Geo>('Geo');

// The geo of a request, as JSON, the way Directus takes the filter and its SDK sends a parameter it does not know
// (V-171), checked against the contract before anything reaches the database (D-016).
export const geoOf = (raw: unknown): Geo => {
	if (raw === undefined) {
		throw new InvalidQueryError({ reason: 'The geo parameter is required' });
	}

	if (typeof raw !== 'string') {
		throw new InvalidQueryError({ reason: 'The geo parameter goes as JSON' });
	}

	let value: unknown;

	try {
		value = JSON.parse(raw);
	} catch {
		throw new InvalidQueryError({ reason: 'The geo parameter is not valid JSON' });
	}

	const checked = checkGeo(value);

	if (!checked.valid) {
		throw new InvalidQueryError({ reason: `The geo parameter is off the contract: ${checked.errors.join(', ')}` });
	}

	return checked.value;
};

// The parameters of /items that change what comes back and that the operations do not take yet. A request with one
// is refused, instead of having it quietly left out. The order comes in F02-10.
const notYet = ['sort', 'aggregate', 'group', 'deep', 'alias', 'backlink', 'version', 'export'] as const;

// The first parameter of the page the operations do not take yet, or undefined. The query of the operation reads one
// level, so the fields of a relation would come back as their keys, and not as /items gives them.
export const unsupportedIn = (page: Query): string | undefined =>
	notYet.find((parameter) => page[parameter] !== undefined) ??
	(page.fields?.some((field) => field.includes('.')) === true ? 'fields of a relation' : undefined);

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

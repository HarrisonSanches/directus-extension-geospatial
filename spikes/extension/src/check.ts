import { createError, InvalidQueryError } from '@directus/errors';
import type { ApiExtensionContext } from '@directus/types';
import { type Adapter, adapters, candidates, type Expectation } from './adapters.js';
import { type Context, permittedQuery } from './permitted-query.js';

// The response says nothing of the internals, which go to the log, and to the admin by the route of the adapters.
const InternalsUnsupportedError = createError(
	'GEOSPATIAL_INTERNALS_UNSUPPORTED',
	'The geospatial operations are off, because this Directus is not one the extension supports.',
	503,
);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const reasonOf = (error: unknown) =>
	error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : String(error);

// A module of @directus/api as the running Directus has it, or why it could not be imported.
const load = async (specifier: string): Promise<{ module: Record<string, unknown> } | { reason: string }> => {
	try {
		const module: unknown = await import(specifier);

		return isRecord(module) ? { module } : { reason: 'not a module' };
	} catch (error) {
		return { reason: reasonOf(error) };
	}
};

// What the running Directus has against one expectation of an adapter: whether the module exists, the function it
// exports, and the number of parameters the function declares.
const problemOf = async (expectation: Expectation): Promise<string | undefined> => {
	const specifier = `@directus/api/${expectation.module}`;
	const loaded = await load(specifier);

	if ('absent' in expectation) {
		return 'module' in loaded ? `${specifier} exists, and ${expectation.absent}` : undefined;
	}

	if (!('module' in loaded)) {
		return `${specifier} could not be imported (${loaded.reason})`;
	}

	const value = loaded.module[expectation.function];

	if (typeof value !== 'function') {
		return `${specifier} has no function ${expectation.function}`;
	}

	if (value.length !== expectation.arity) {
		return `${specifier}: ${expectation.function} declares ${String(value.length)} parameters, and the adapter expects ${String(expectation.arity)}`;
	}

	return undefined;
};

// The chain on a collection of Directus itself, as the admin, which reads no row, no permission and no policy: the
// check sees what each step returns, and the builder at the end never runs.
const shapeProblemsOf = async (adapter: Adapter, context: Context): Promise<string[]> => {
	const collection = 'directus_collections';

	try {
		await adapter.beforeHooks({ collection, accountability: null }, context);

		const { builder } = await permittedQuery(
			{ collection, query: { fields: ['collection'], limit: 1 }, accountability: null },
			context,
		);

		// The name alone, since Postgres quotes it with double quotes, and SQLite with backticks.
		const { sql } = builder.toSQL();

		return sql.includes(collection) ? [] : [`the chain built a query that does not read ${collection}: ${sql}`];
	} catch (error) {
		return [`the chain failed on ${collection}: ${error instanceof Error ? error.message : String(error)}`];
	}
};

const checks = new Map<string, Promise<string[]>>();

// What the running Directus lacks, or has besides, of what an adapter expects, found by what exists, and not by the
// version. No problem means the adapter can build the permitted query. The Directus of a process never changes, so
// each adapter is checked once, as the extension of F02 does when it starts (§5, protection 2).
export const problemsOf = (adapter: Adapter, context: Context): Promise<string[]> => {
	const known = checks.get(adapter.name);

	if (known !== undefined) {
		return known;
	}

	const checking = (async () => {
		const problems = (await Promise.all(adapter.expects.map(problemOf))).filter(
			(problem): problem is string => problem !== undefined,
		);

		return problems.length > 0 ? problems : shapeProblemsOf(adapter, context);
	})();

	checks.set(adapter.name, checking);

	return checking;
};

// The adapter a request forces, or the first one the running Directus passes. With none, the radius fails closed,
// before it builds any query.
export const adapterFor = async (
	name: string | undefined,
	context: Context,
	logger: ApiExtensionContext['logger'],
): Promise<Adapter> => {
	const forced = name === undefined ? undefined : adapters[name];

	if (name !== undefined && forced === undefined) {
		throw new InvalidQueryError({ reason: `adapter must be one of ${Object.keys(adapters).join(', ')}` });
	}

	for (const adapter of forced === undefined ? candidates : [forced]) {
		const problems = await problemsOf(adapter, context);

		if (problems.length === 0) {
			return adapter;
		}

		logger.warn({ adapter: adapter.name, problems }, 'The running Directus does not pass the adapter');
	}

	throw new InternalsUnsupportedError();
};

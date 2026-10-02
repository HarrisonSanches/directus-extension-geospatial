import type { Internals } from 'directus-geospatial-contract';
import type { Adapter } from './adapters.js';
import { chain, type Context } from './chain.js';
import { functions, type Load, type ModulePath, ownerOf, takeFrom } from './modules.js';

type Loaded = { module: Record<string, unknown> } | { reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The code of a Node error, such as ERR_MODULE_NOT_FOUND, or the error itself.
const reasonOf = (error: unknown) => (isRecord(error) && typeof error.code === 'string' ? error.code : String(error));

const loadWith =
	(load: Load) =>
	async (path: ModulePath): Promise<Loaded> => {
		try {
			const module = await load(path);

			return isRecord(module) ? { module } : { reason: 'not a module' };
		} catch (error) {
			return { reason: reasonOf(error) };
		}
	};

const collection = 'directus_collections';

// The chain on a collection of Directus itself, with no accountability, as Directus reads for itself, which goes the
// way of the admin: it reads no row, no permission and no policy, and the builder at the end never runs (V-146). It
// emits no event, so no hook of another extension runs for a read that no one asked for.
const shapeProblemsOf = async (
	adapter: Adapter,
	modules: ReadonlyMap<ModulePath, Record<string, unknown>>,
	context: Context,
): Promise<string[]> => {
	try {
		const take = takeFrom(modules);
		const request = { collection, query: { fields: ['collection'], limit: 1 }, accountability: null };

		await adapter.beforeHooks(take, request, context);

		const { builder } = await chain(take, request, context);

		// The name alone, since Postgres quotes it with double quotes, and SQLite with backticks.
		const { sql } = builder.toSQL();

		return sql.includes(collection) ? [] : [`the chain built a query that does not read ${collection}: ${sql}`];
	} catch (error) {
		return [`the chain failed on ${collection}: ${error instanceof Error ? error.message : String(error)}`];
	}
};

// What the running Directus lacks, or has besides, of what an adapter expects: the module, the function and the number
// of parameters it declares, and then the shape of what each step of the chain returns.
const problemsOf = async (
	adapter: Adapter,
	loaded: (path: ModulePath) => Promise<Loaded>,
	context: Context,
): Promise<string[]> => {
	const problems: string[] = [];
	const modules = new Map<ModulePath, Record<string, unknown>>();

	for (const name of adapter.uses) {
		const { module: path, arity } = functions[name];
		const specifier = `@directus/api/${path}`;
		const found = await loaded(path);

		if ('reason' in found) {
			problems.push(`${specifier} could not be imported (${found.reason})`);
			continue;
		}

		const owner = ownerOf(found.module, name);
		const value = isRecord(owner) ? owner[name] : undefined;

		modules.set(path, found.module);

		if (typeof value !== 'function') {
			problems.push(`${specifier} has no function ${name}`);
		} else if (value.length !== arity) {
			problems.push(
				`${specifier}: ${name} declares ${String(value.length)} parameters, and the adapter expects ${String(arity)}`,
			);
		}
	}

	for (const { module: path, because } of adapter.lacks) {
		const specifier = `@directus/api/${path}`;
		const found = await loaded(path);

		if (!('reason' in found)) {
			problems.push(`${specifier} exists, and ${because}`);
		} else if (found.reason !== 'ERR_MODULE_NOT_FOUND') {
			problems.push(
				`${specifier} could not be imported (${found.reason}), so the check cannot tell whether ${because}`,
			);
		}
	}

	return problems.length > 0 ? problems : shapeProblemsOf(adapter, modules, context);
};

// Whether the running Directus has the internals an adapter expects, found by what exists, and not by the version
// (§5, protection 2). The adapters go in order, and the first one that passes is the one of this Directus. With none,
// the result says what each one found.
export const checkInternals = async (
	adapters: readonly Adapter[],
	load: Load,
	context: Context,
): Promise<Internals> => {
	// Each module is imported once, for every adapter that uses it.
	const imports = new Map<ModulePath, Promise<Loaded>>();
	const loaded = (path: ModulePath) => {
		const known = imports.get(path) ?? loadWith(load)(path);

		imports.set(path, known);

		return known;
	};

	const problems: Record<string, string[]> = {};

	for (const adapter of adapters) {
		const found = await problemsOf(adapter, loaded, context);

		if (found.length === 0) {
			return { status: 'accepted', adapter: adapter.name };
		}

		problems[adapter.name] = found;
	}

	return { status: 'refused', problems };
};

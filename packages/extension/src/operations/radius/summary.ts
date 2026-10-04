import { createHash } from 'node:crypto';
import type { QuerySummaryResponse } from 'directus-geospatial-contract';
import type { Knex } from 'knex';
import { failClosed } from '../../db/fail-closed.js';
import { limits } from '../../limits.js';
import type { Counts } from '../../query/counts.js';
import { type Checking, circleAround, type Engine, permittedRadius, type RadiusRequest, takenBy } from './items.js';

// What the summary needs of the engine: the checks of each part of the radius, the log, and the exact counts.
export type Summing = Checking & Pick<Engine, 'logger'> & { counts: Counts };

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The number a count brought, in the one row it returns: a text in Postgres, whose count is a bigint, and a number in
// SQLite.
const totalIn = (rows: unknown): number => {
	const [row] = [rows].flat().filter(isRow);

	return Number(row?.count);
};

// The key of an exact count: its statement as it goes to the database, with the values, which carry the rules of the
// policies of whoever asks, so whoever has other permissions never gets the total (D-006). A hash keeps it short.
const keyOf = (statement: Knex.QueryBuilder) => {
	const { sql, bindings } = statement.toSQL();

	return createHash('sha256')
		.update(JSON.stringify([sql, bindings]))
		.digest('base64url');
};

const summaryOf = (total: number, exact: boolean, counting: boolean): QuerySummaryResponse => ({
	data: { total, exact, counting },
});

// The summary of the radius, the total of its items in two times (§7.1, D-056). The quick count reads up to one item
// past 10,000, in the request, and up to 10,000 the total is exact. Past that, the exact count runs in the background,
// in a transaction whose statement the database cancels past the time maximum, and a request after this one brings its
// total. Where the database bounds no statement in time, the summary keeps the quick count. Both counts read the
// permitted query of whoever asks (D-001).
export const radiusSummary = async (
	request: Omit<RadiusRequest, 'cursor'>,
	engine: Summing,
): Promise<QuerySummaryResponse> => {
	const { knex, logger, counts, defaultLimit } = engine;
	const { collection, geo, page } = request;
	const { quick, timeout } = limits.summary;

	takenBy(page, defaultLimit);

	const { builder: permitted, declared, geometry } = await permittedRadius(request, engine);

	return failClosed(async () => {
		const envelope = await circleAround(knex, declared, { permitted, collection, geometry, geo });
		const { count, bounded } = declared.adapter;
		const read = totalIn(await count(knex, envelope, quick + 1));

		if (read <= quick) {
			return summaryOf(read, true, false);
		}

		if (bounded === undefined) {
			return summaryOf(quick, false, false);
		}

		const exact = count(knex, envelope);
		const known = counts.exactOf(keyOf(exact), () =>
			bounded(knex, timeout, async (transaction) => totalIn(await exact.transacting(transaction))),
		);

		return known.state === 'counted'
			? summaryOf(known.total, true, false)
			: summaryOf(quick, false, known.state === 'counting');
	}, logger);
};

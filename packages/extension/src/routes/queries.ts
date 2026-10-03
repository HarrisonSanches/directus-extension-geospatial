import type { Accountability, SchemaOverview } from '@directus/types';
import type { RegisterQueryResponse } from 'directus-geospatial-contract';
import type { PageQuery } from '../internals/page.js';
import { registeredQueryOf } from '../operations/request.js';
import { register } from '../query/register.js';
import type { Registry } from '../query/registry.js';

// The part of a request of Express the registration reads, with what Directus attaches to it (directus.d.ts).
interface Incoming {
	body?: unknown;
	headers: Record<string, string | string[] | undefined>;
	accountability?: Accountability;
	schema: SchemaOverview;
}

interface Registration {
	registry: Registry;
	key: Buffer;
	now: () => number;
	pageQuery: PageQuery;
}

// The registration of a query (D-004): the body checked against the contract, and the query of /items in it read as
// Directus reads its own, for whoever registers.
export const registerQuery = async (
	incoming: Incoming,
	{ pageQuery, ...registration }: Registration,
): Promise<RegisterQueryResponse> => {
	const question = registeredQueryOf(incoming.headers['content-length'], incoming.body);
	const id = await register(question, {
		...registration,
		read: (raw) => pageQuery(raw, incoming.schema, incoming.accountability),
	});

	return { data: { id } };
};

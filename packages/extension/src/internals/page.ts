import type { Accountability, Query, SchemaOverview } from '@directus/types';
import type { Internals } from 'directus-geospatial-contract';
import type { Logger } from 'pino';
import { acceptedWith, offOnMismatch } from './accepted.js';
import { type Load, load as loadDirectus } from './modules.js';

// The query of /items in the body of a SEARCH, which the extension reads as Directus reads its own: sanitized for the
// schema and the accountability of the request, and validated (V-181). Directus does it only on its own routes, and the
// query of the URL it sanitizes on every route.
export type PageQuery = (
	raw: Record<string, unknown>,
	schema: SchemaOverview,
	accountability: Accountability | undefined,
) => Promise<Query>;

export const pageQueryWith = (
	internals: () => Promise<Internals>,
	logger: Pick<Logger, 'error'>,
	load: Load = loadDirectus,
): PageQuery => {
	const accepted = acceptedWith(internals, load);

	return async (raw, schema, accountability) => {
		const { take } = await accepted();

		return offOnMismatch(
			async () => take('validateQuery')(await take('sanitizeQuery')(raw, schema, accountability ?? null)),
			logger,
		);
	};
};

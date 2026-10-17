import type { Accountability, Query, SchemaOverview } from '@directus/types';

// What Directus attaches to each request, declared the way Directus declares it (api/src/types/express.d.ts): the
// accountability, the schema, and the query of /items, sanitized before the routes of the extensions (V-143).
declare global {
	namespace Express {
		interface Request {
			accountability?: Accountability;
			schema: SchemaOverview;
			sanitizedQuery: Query;
		}
	}
}

import type { Accountability, Query } from '@directus/types';

// What Directus attaches to each request, declared the way Directus declares it (api/src/types/express.d.ts).
declare global {
	namespace Express {
		interface Request {
			accountability?: Accountability;
			// The query of the request, parsed and validated by the middleware Directus runs before every route, extensions
			// included, the same query the /items reads with (api/src/middleware/sanitize-query.ts).
			sanitizedQuery?: Query;
		}
	}
}

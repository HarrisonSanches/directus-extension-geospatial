import type { Accountability } from '@directus/types';

// What Directus attaches to each request, declared the way Directus declares it (api/src/types/express.d.ts).
declare global {
	namespace Express {
		interface Request {
			accountability?: Accountability;
		}
	}
}

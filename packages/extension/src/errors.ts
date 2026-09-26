import { createError } from '@directus/errors';
import type { ErrorCode } from 'directus-geospatial-contract';

// The contract lists every code of the extension, so a code it does not list fails the type check.
const code = (value: ErrorCode): ErrorCode => value;

// The message never says why, so no SQL, host or driver detail reaches the response. The cause goes to the log.
export const DatabaseUnavailableError = createError(
	code('GEOSPATIAL_DATABASE_UNAVAILABLE'),
	'The database did not answer. Try again later.',
	503,
);

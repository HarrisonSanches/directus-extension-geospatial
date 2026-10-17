import { type DirectusApiError, type DirectusError, isDirectusError } from '@directus/sdk';
import type { ErrorCode } from 'directus-geospatial-contract';

// A code a route of the extension answers with: one of its own (D-045), or one of Directus it passes on as it came, such
// as FORBIDDEN or INVALID_QUERY.
export type GeospatialErrorCode = ErrorCode | (string & {});

// An error of the API in the format of Directus, whose first error carries the code.
export interface GeospatialError<Code extends GeospatialErrorCode = ErrorCode> extends DirectusError {
	errors: [DirectusApiError & { extensions: { code: Code } }, ...DirectusApiError[]];
}

// Whether a request of the SDK rejected with an error of the API, as isDirectusError tells, with the code of its first
// error typed: without a code, one of the extension, by the prefix GEOSPATIAL_ (D-045); with a code, that one, of the
// extension or of Directus.
export function isGeospatialError(error: unknown): error is GeospatialError;
export function isGeospatialError<const Code extends GeospatialErrorCode>(
	error: unknown,
	code: Code,
): error is GeospatialError<Code>;
export function isGeospatialError(error: unknown, code?: GeospatialErrorCode): boolean {
	// isDirectusError reads the first error without checking that there is one.
	if (!(typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors))) {
		return false;
	}

	if (error.errors.length === 0 || !isDirectusError(error)) {
		return false;
	}

	const found = error.errors[0]?.extensions.code;

	return code === undefined ? found?.startsWith('GEOSPATIAL_') === true : found === code;
}

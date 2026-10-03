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

// The internals of the running Directus are not the ones an adapter expects, so the operations are off (§5, protection
// 2). What is missing goes only to the admin, through the capabilities.
export const InternalsUnsupportedError = createError(
	code('GEOSPATIAL_INTERNALS_UNSUPPORTED'),
	'The internals of this Directus are not the ones the extension expects, so its operations are off.',
	503,
);

// An operation that does not run on the database in use, with the operation and the reason in the extensions (§7.4).
export const OperationUnavailableError = createError<{ operation: string; reason: string }>(
	code('GEOSPATIAL_OPERATION_UNAVAILABLE'),
	({ operation, reason }) => `The operation ${operation} is unavailable. ${reason}`,
	501,
);

// An input off the contract, which never reaches the database: the reason says where and why, with the place and the
// rule, and never the values the request sent (§7.8, D-045).
export const InvalidInputError = createError<{ reason: string }>(
	code('GEOSPATIAL_INVALID_INPUT'),
	({ reason }) => `Invalid input. ${reason}.`,
	400,
);

// A request past a limit of the extension, with the limit in the extensions (§7.8).
export const LimitExceededError = createError<{ limit: number }>(
	code('GEOSPATIAL_LIMIT_EXCEEDED'),
	({ limit }) => `The request is larger than the extension takes, ${String(limit)} bytes.`,
	413,
);

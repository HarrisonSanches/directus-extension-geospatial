import { isDirectusError } from '@directus/errors';
import type { Logger } from 'pino';
import { DatabaseUnavailableError } from '../errors.js';

// Runs the reads of the database a route depends on. When they fail, the route fails closed: it answers with an error
// of its own instead of guessing, and Directus, which shows the message of an unknown error to admins, never gets the
// one of the driver. An error of Directus already has the format and the message of Directus, and passes as it came.
export const failClosed = async <T>(read: () => Promise<T>, logger: Pick<Logger, 'error'>): Promise<T> => {
	try {
		return await read();
	} catch (error) {
		if (isDirectusError(error)) {
			throw error;
		}

		logger.error(error, 'The database did not answer');

		throw new DatabaseUnavailableError();
	}
};

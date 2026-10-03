import type { Internals } from 'directus-geospatial-contract';
import type { Logger } from 'pino';
import { InternalsUnsupportedError } from '../errors.js';
import { type Adapter, adapters } from './adapters.js';
import { functions, InternalsMismatchError, type Load, type Take, takeFrom } from './modules.js';

// The adapter the check accepted for the running Directus, with its functions. With the internals refused, every
// operation is off, and the request goes no further (§5, protection 2).
export const acceptedWith =
	(internals: () => Promise<Internals>, load: Load) => async (): Promise<{ adapter: Adapter; take: Take }> => {
		const checked = await internals();
		const adapter = checked.status === 'accepted' ? adapters.find(({ name }) => name === checked.adapter) : undefined;

		if (adapter === undefined) {
			throw new InternalsUnsupportedError();
		}

		// Node keeps each module after its first import, the one of the check, so these cost nothing.
		const modules = new Map(
			await Promise.all(
				adapter.uses.map(async (name) => {
					const path = functions[name].module;

					return [path, await load(path)] as const;
				}),
			),
		);

		return { adapter, take: takeFrom(modules) };
	};

// A step that returns another shape at the time of a request turns the operations off as the check would, and the shape
// goes to the log, since the response carries no detail of the internals.
export const offOnMismatch = async <T>(run: () => Promise<T>, logger: Pick<Logger, 'error'>): Promise<T> => {
	try {
		return await run();
	} catch (error) {
		if (error instanceof InternalsMismatchError) {
			logger.error(error, 'The internals of Directus changed shape, so the geospatial operations are off');

			throw new InternalsUnsupportedError();
		}

		throw error;
	}
};

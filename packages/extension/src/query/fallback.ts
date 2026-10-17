import type { RegisteredQuery } from 'directus-geospatial-contract';
import type { Logger } from 'pino';
import type { Registry } from './registry.js';

// The registry every instance shares, the Redis of Directus, which says whether its connection is up.
export interface Shared extends Registry {
	ready: () => boolean;
}

interface Options {
	// The shared registry, once the check of the Redis of Directus is done, or undefined, when Directus uses no Redis.
	shared: Promise<Shared | undefined>;
	// The memory of this instance.
	memory: Registry;
	// The most a command of the shared registry takes, in milliseconds, before the request goes to the memory.
	answer: number;
	// Runs run after ms milliseconds, unless what it returns cancels it first.
	after: (ms: number, run: () => void) => () => void;
	logger: Pick<Logger, 'warn' | 'info'>;
}

// The registry of an installation that uses Redis, which falls back to the memory of the instance while Redis is down
// (D-057). The client of Redis waits from 10 s to minutes before it gives up on a command (V-188), so a connection that
// is not up sends no command, and a command that does not answer in time goes to the memory. A forgotten id only has the
// client register again (§7.8). The log warns once when Redis goes down, and says when it is back.
export const fallbackRegistry = ({ shared, memory, answer, after, logger }: Options): Registry => {
	let down = false;

	const wentDown = (cause: unknown) => {
		if (!down) {
			down = true;
			logger.warn(cause, 'Redis did not answer, so the registered queries go to the memory of this instance');
		}
	};

	const cameBack = () => {
		if (down) {
			down = false;
			logger.info('Redis answers again, and the registered queries go back to it');
		}
	};

	// What the shared registry answers within the time maximum, or why it did not.
	const fromShared = async <T>(registry: Shared, command: (registry: Shared) => Promise<T>): Promise<T> => {
		if (!registry.ready()) {
			throw new Error('The connection to Redis is not up');
		}

		const late = Promise.withResolvers<never>();
		const cancel = after(answer, () => {
			late.reject(new Error(`Redis did not answer within ${String(answer)} ms`));
		});

		try {
			return await Promise.race([command(registry), late.promise]);
		} finally {
			cancel();
		}
	};

	return {
		put: async (id, question) => {
			const registry = await shared;

			if (registry === undefined) {
				return memory.put(id, question);
			}

			try {
				await fromShared(registry, (on) => on.put(id, question));
				cameBack();
			} catch (error) {
				wentDown(error);
				await memory.put(id, question);
			}
		},
		get: async (id) => {
			const registry = await shared;

			if (registry === undefined) {
				return memory.get(id);
			}

			let question: RegisteredQuery | undefined;

			try {
				question = await fromShared(registry, (on) => on.get(id));
				cameBack();
			} catch (error) {
				wentDown(error);
			}

			// An id registered while Redis was down stays in the memory of this instance.
			return question ?? memory.get(id);
		},
	};
};

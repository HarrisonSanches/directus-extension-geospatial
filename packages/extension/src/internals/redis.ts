import type { Logger } from 'pino';

// The client of Redis the registry sends its commands with, the one Directus shares among its own parts (V-188).
export interface RedisClient {
	// The state of the connection: ready once it is up, and connecting or reconnecting while Redis is down.
	status: string;
	eval: (script: string, keys: number, ...args: (string | number)[]) => Promise<unknown>;
}

// The module redis/index of the running Directus, or the error of its import.
type LoadRedis = () => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const withNoParameters = (value: unknown): value is () => unknown => typeof value === 'function' && value.length === 0;

const isClient = (value: unknown): value is RedisClient =>
	isRecord(value) && typeof value.status === 'string' && typeof value.eval === 'function';

// The Redis of Directus, when it uses one, whose client the extension shares, or undefined, for the memory (§7.8).
// Directus uses Redis when REDIS or any variable that starts with REDIS_ is set, unless REDIS_ENABLED says otherwise,
// and the extension follows it, with no setting of its own (V-188). The check sees the module, its two functions with no
// parameters and the shape of the client. A Directus that changed them keeps the registry in memory, with a warning, and
// the rest of the extension goes on.
export const redisOf = async (
	logger: Pick<Logger, 'warn' | 'info'>,
	load: LoadRedis = () => import('@directus/api/redis/index'),
): Promise<RedisClient | undefined> => {
	try {
		const module = await load();
		const { redisConfigAvailable: available, useRedis: use } = isRecord(module) ? module : {};

		if (!withNoParameters(available) || !withNoParameters(use)) {
			throw new Error('The running Directus has no redisConfigAvailable and useRedis with no parameters');
		}

		if (available() !== true) {
			return undefined;
		}

		const client = use();

		if (!isClient(client)) {
			throw new Error('The client of Redis of Directus has no status or no eval');
		}

		logger.info('Directus uses Redis, and the registered queries go to it, shared by every instance');

		return client;
	} catch (error) {
		logger.warn(
			error,
			'Could not use the Redis of Directus, so the registered queries stay in the memory of each instance',
		);

		return undefined;
	}
};

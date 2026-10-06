import type { RegisteredQuery } from 'directus-geospatial-contract';
import type { RedisClient } from '../internals/redis.js';
import type { Shared } from './fallback.js';

interface Options {
	// The client of Redis Directus shares (internals/redis.ts).
	client: RedisClient;
	// How long a question is kept since it was last used, in milliseconds (D-038).
	retention: number;
	// The most bytes the questions of every instance take together, in JSON, past which the least recently used go first.
	bytes: number;
	// The clock, in milliseconds.
	now: () => number;
}

// The keys of the registry in Redis, under the prefix of the extension: each question by its id, with the retention as
// its own expiry, and what the ceiling reads, which holds no question: the time of the last use of each id, the bytes of
// each one, and their sum.
const prefix = 'geospatial:registry:';

// What both scripts share. A question leaves Redis at its time, by its expiry, and what the registry keeps of it leaves at
// the next command of any instance. Each script runs whole, with no command of another instance in the middle, so the
// sum and the order of use stay right with many instances. The keys besides the prefix are built in the script, which
// Redis takes outside of a cluster, the way Directus connects to it (V-188).
const shared = `
local prefix = KEYS[1]
local used, sizes, held = prefix .. 'used', prefix .. 'sizes', prefix .. 'held'

local function forget(id)
	local size = redis.call('HGET', sizes, id)

	if size then
		redis.call('DECRBY', held, size)
		redis.call('HDEL', sizes, id)
	end

	redis.call('ZREM', used, id)
	redis.call('DEL', prefix .. 'question:' .. id)
end

local function sweep(now, retention)
	for _, id in ipairs(redis.call('ZRANGEBYSCORE', used, '-inf', now - retention)) do
		forget(id)
	end
end
`;

// Keeps a question under its id, and past the ceiling, takes out the least recently used ones first (LRU). A question
// registered again counts once.
const put = `${shared}
local id, question = ARGV[1], ARGV[2]
local now, retention, ceiling = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])

sweep(now, retention)
forget(id)
redis.call('SET', prefix .. 'question:' .. id, question, 'PX', retention)
redis.call('ZADD', used, now, id)
redis.call('HSET', sizes, id, #question)
redis.call('INCRBY', held, #question)

while tonumber(redis.call('GET', held)) > ceiling do
	local oldest = redis.call('ZRANGE', used, 0, 0)[1]

	if not oldest then
		break
	end

	forget(oldest)
end

return 'OK'
`;

// The question of an id, which renews its retention, or nothing.
const get = `${shared}
local id = ARGV[1]
local now, retention = tonumber(ARGV[2]), tonumber(ARGV[3])
local key = prefix .. 'question:' .. id

sweep(now, retention)

local question = redis.call('GET', key)

if not question then
	return false
end

redis.call('PEXPIRE', key, retention)
redis.call('ZADD', used, now, id)

return question
`;

// The registry in the Redis of Directus, which every instance shares (§7.8, D-057): the same retention since the last
// use and the same ceiling of D-053, for all the instances together.
const redisRegistry = ({ client, retention, bytes, now }: Options): Shared => ({
	ready: () => client.status === 'ready',
	put: async (id, question) => {
		await client.eval(put, 1, prefix, id, JSON.stringify(question), now(), retention, bytes);
	},
	get: async (id) => {
		const question = await client.eval(get, 1, prefix, id, now(), retention);

		// The question went into Redis from the registration, which checked it against the contract.
		return typeof question === 'string' ? (JSON.parse(question) as RegisteredQuery) : undefined;
	},
});

// The registry in Redis once the check of the Redis of Directus is done, or undefined, when Directus uses no Redis
// (internals/redis.ts).
export const sharedOn = async (
	client: Promise<RedisClient | undefined>,
	options: Omit<Options, 'client'>,
): Promise<Shared | undefined> => {
	const found = await client;

	return found === undefined ? undefined : redisRegistry({ client: found, ...options });
};

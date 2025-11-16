import { env } from '$env/dynamic/private';
import { Context, Effect } from 'effect';
import { TaggedError } from 'effect/Data';
import Redis from 'ioredis';

const globalForDb = globalThis as unknown as {
	redisClient: Redis | undefined;
};

const getClient = () => {
	if (!globalForDb.redisClient) {
		globalForDb.redisClient = new Redis(env.REDIS_URL);
	}

	return globalForDb.redisClient;
};

const redisClient = new Proxy({} as Redis, {
	get: (_, prop) => {
		const client = getClient();
		return client[prop as keyof Redis];
	}
});

// yea ik the above is not the effect-y way to get the redis client but it's nice for serverless so leave me alone

class RedisError extends TaggedError('RedisError') {
	cause: unknown;

	constructor(cause: unknown) {
		super();
		this.cause = cause;
	}
}

const redisService = Effect.gen(function* () {
	const makeStreamKey = (key: string) => Effect.succeed(`QUESTION-AGENT-STREAM:${key}`);

	const appendToStream = (key: string, value: string) =>
		Effect.gen(function* () {
			const streamKey = yield* makeStreamKey(key);

			yield* Effect.tryPromise({
				try: () => redisClient.xadd(streamKey, '*', 'chunk', value),
				catch: (error) => new RedisError(error)
			});
		});

	return {
		appendToStream
	};
});

export class RedisService extends Effect.Service<RedisService>()('RedisService', {
	effect: redisService,
	dependencies: []
}) {}

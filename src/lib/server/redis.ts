import { env } from '$env/dynamic/private';
import { Effect, Scope } from 'effect';
import { TaggedError } from 'effect/Data';
import Redis from 'ioredis';

// ok so apparently this is causing issues because the redis instance is getting shared around between redisClient and subscribeClient
// works great locally, but on vercel shit seems to be getting fucked up... need to investigate further...

class RedisError extends TaggedError('RedisError') {
	cause: unknown;

	constructor(cause: unknown) {
		super();
		this.cause = cause;
	}
}

const redisService = Effect.gen(function* () {
	const makeStreamKey = (key: string) => Effect.succeed(`QUESTION-AGENT-STREAM:${key}`);

	const subscribeToStream = (
		key: string,
		processor: (message: string) => void,
		scope: Scope.CloseableScope
	) =>
		Effect.gen(function* () {
			const streamKey = yield* makeStreamKey(key);

			// yea ik I should be duplicating the client above but then the scopes get hellish again and I don't care enough leave me alone
			const subscribeClient = yield* Effect.sync(() => new Redis(env.REDIS_URL));
			const redisClient = yield* Effect.sync(() => new Redis(env.REDIS_URL));

			yield* Scope.addFinalizer(
				scope,
				Effect.promise(() => Promise.all([subscribeClient.quit(), redisClient.quit()]))
			);

			yield* Effect.sync(() =>
				subscribeClient.on('message', (channel, message) => {
					if (channel !== streamKey) return;
					processor(message);
				})
			);

			const existingMessages = yield* Effect.tryPromise({
				try: () => redisClient.xread('BLOCK', 0, 'STREAMS', streamKey, '0'),
				catch: (error) => new RedisError(error)
			});

			if (existingMessages && existingMessages.length > 0) {
				const [result] = existingMessages;

				if (result) {
					const [, entries] = result;

					for (const [, fields] of entries) {
						const [type, data] = fields;

						if (type == 'chunk' && data) {
							processor(data);
						}
					}
				}
			}

			yield* Effect.tryPromise({
				try: () => subscribeClient.subscribe(streamKey),
				catch: (error) => new RedisError(error)
			});
		});

	const appendToStream = (key: string, value: string) =>
		Effect.gen(function* () {
			const redisClient = yield* Effect.sync(() => new Redis(env.REDIS_URL));
			const streamKey = yield* makeStreamKey(key);

			yield* Effect.all(
				[
					Effect.tryPromise({
						try: () => redisClient.publish(streamKey, value),
						catch: (error) => new RedisError(error)
					}),

					Effect.tryPromise({
						try: () => redisClient.xadd(streamKey, '*', 'chunk', value),
						catch: (error) => new RedisError(error)
					})
				],
				{ concurrency: 'unbounded' }
			);

			yield* Effect.promise(() => redisClient.quit());
		});

	return {
		appendToStream,
		subscribeToStream
	};
});

export class RedisService extends Effect.Service<RedisService>()('RedisService', {
	effect: redisService,
	dependencies: []
}) {}

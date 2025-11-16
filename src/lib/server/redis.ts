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
	const scope = yield* Scope.Scope;

	const makeStreamKey = (key: string) => Effect.succeed(`QUESTION-AGENT-STREAM:${key}`);

	const mainRedisClient = yield* Effect.sync(() => new Redis(env.REDIS_URL));

	yield* Scope.addFinalizer(
		scope,
		Effect.all([
			Effect.logInfo('QUITTING MAIN REDIS CLIENT'),
			Effect.promise(() => mainRedisClient.quit())
		])
	);

	const subscribeToStream = (
		key: string,
		processor: (message: string) => void,
		scope: Scope.CloseableScope
	) =>
		Effect.gen(function* () {
			const streamKey = yield* makeStreamKey(key);

			const existingMessages = yield* Effect.tryPromise({
				try: () => mainRedisClient.xread('STREAMS', streamKey, '0'),
				catch: (error) => new RedisError(error)
			});

			if (existingMessages && Array.isArray(existingMessages) && existingMessages.length > 0) {
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

			const subscribeRedisClient = yield* Effect.sync(() => new Redis(env.REDIS_URL));

			yield* Scope.addFinalizer(
				scope,
				Effect.all([
					Effect.logInfo('UNSUBSCRIBING FROM STREAM'),
					Effect.promise(() => subscribeRedisClient.unsubscribe()),
					Effect.promise(() => subscribeRedisClient.quit())
				])
			);

			yield* Effect.sync(() =>
				subscribeRedisClient.on('message', (channel, message) => {
					if (channel !== streamKey) return;
					processor(message);
				})
			);

			yield* Effect.tryPromise({
				try: () => subscribeRedisClient.subscribe(streamKey),
				catch: (error) => new RedisError(error)
			});
		});

	const appendToStream = (key: string, value: string) =>
		Effect.gen(function* () {
			const streamKey = yield* makeStreamKey(key);

			yield* Effect.all(
				[
					Effect.tryPromise({
						try: () => mainRedisClient.publish(streamKey, value),
						catch: (error) => new RedisError(error)
					}),

					Effect.tryPromise({
						try: () => mainRedisClient.xadd(streamKey, '*', 'chunk', value),
						catch: (error) => new RedisError(error)
					})
				],
				{ concurrency: 'unbounded' }
			);
		});

	return {
		appendToStream,
		subscribeToStream
	};
});

export class RedisService extends Effect.Service<RedisService>()('RedisService', {
	scoped: redisService,
	dependencies: []
}) {}

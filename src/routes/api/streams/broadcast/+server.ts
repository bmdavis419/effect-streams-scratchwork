import { Console, Effect, Exit, Fiber, pipe, Queue, Runtime, Schema, Stream, Take } from 'effect';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { CharacterClassification } from '$lib/shared/types';
import * as Sse from '@effect/experimental/Sse';

const bodySchema = Schema.Struct({
	message: Schema.String
});

const getEffect = (event: RequestEvent) =>
	Effect.scoped(
		Effect.gen(function* () {
			const { message } = yield* pipe(
				Effect.tryPromise({
					try: () => event.request.json(),
					catch: (e) => ({
						status: 400,
						message: `Got invalid json: ${e}`
					})
				}),
				Effect.flatMap((body) =>
					Schema.decode(bodySchema)(body).pipe(
						Effect.mapError((e) => ({
							status: 400,
							message: `Failed to parse body: ${e.message}`
						}))
					)
				)
			);

			const characters = message.split('');

			const baseStream = Stream.fromIterable(characters).pipe(
				Stream.mapEffect((c) => Effect.delay(Effect.succeed(c), '100 millis')),
				Stream.map<string, CharacterClassification>((c) => {
					const isVowel = /^[aeiou]$/i.test(c);
					if (isVowel) {
						return {
							type: 'vowel',
							character: c
						};
					}

					const isConsonant = /^[bcdfghjklmnpqrstvwxyz]$/i.test(c);
					if (isConsonant) {
						return {
							type: 'consonant',
							character: c
						};
					}

					return {
						type: 'other',
						character: c
					};
				})
			);

			const runtime = yield* Effect.runtime();

			const [respStream, bgStream] = yield* Stream.broadcast(baseStream, 2, {
				capacity: 'unbounded'
			});

			Runtime.runFork(runtime)(
				pipe(
					bgStream,
					Stream.runForEach((data) =>
						Console.log(`background stream: ${data.character} is a ${data.type}`)
					)
				)
			);

			const sseStream = pipe(
				respStream,
				Stream.tap((data) => Console.log(`stuff getting sent to the readable stream: ${data}`)),
				Stream.map(
					(data): Sse.Event => ({
						_tag: 'Event',
						event: 'data',
						id: undefined,
						data: JSON.stringify(data)
					})
				),
				Stream.map(Sse.encoder.write)
			);

			const readableStream = Stream.toReadableStreamRuntime(sseStream, runtime);

			return {
				response: new Response(readableStream)
			};
		})
	);

export const POST = async (event) => {
	const result = await pipe(
		getEffect(event),
		Effect.exit,
		Effect.map((exit) =>
			Exit.match(exit, {
				onSuccess: ({ response }) => {
					return {
						type: 'success' as const,
						response
					};
				},
				onFailure: (cause) => {
					if (cause._tag === 'Fail') {
						return {
							type: 'error' as const,
							status: cause.error.status,
							message: cause.error.message
						};
					}
					console.error('unknown failure at /api/streams/first', cause.toString());
					return {
						type: 'error' as const,
						status: 500,
						message: 'Unknown error'
					};
				}
			})
		),
		Effect.runPromise
	);

	if (result.type === 'success') {
		return result.response;
	}

	return error(result.status, { message: result.message });
};

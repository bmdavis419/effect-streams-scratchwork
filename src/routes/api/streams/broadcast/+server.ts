import { Cause, Console, Effect, Exit, pipe, Schema, Scope, Stream } from 'effect';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { CharacterClassification } from '$lib/shared/types';
import * as Sse from '@effect/experimental/Sse';

const bodySchema = Schema.Struct({
	message: Schema.String
});

const getEffect = (event: RequestEvent) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
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

		const [respStream, bgStream] = yield* Stream.broadcast(baseStream, 2, {
			capacity: 'unbounded'
		}).pipe(Scope.extend(scope));

		yield* Effect.forkIn(scope)(
			pipe(
				bgStream,
				Stream.runForEach((data) =>
					Console.log(`background stream: ${data.character} is a ${data.type}`)
				),
				Effect.ensuring(Scope.close(scope, Exit.void))
			)
		);

		const sseStream = pipe(
			respStream,
			Stream.map(
				(data): Sse.Event => ({
					_tag: 'Event',
					event: 'data',
					id: undefined,
					data: JSON.stringify(data)
				})
			),
			Stream.map(Sse.encoder.write),
			Stream.toReadableStream
		);

		return {
			response: new Response(sseStream)
		};
	});

// try and hook the scope up to the POST request...

export const POST = async (event) => {
	const result = await pipe(
		getEffect(event),
		Effect.matchCause({
			onSuccess: ({ response }) => {
				return {
					type: 'success' as const,
					response
				};
			},
			onFailure: (cause) => {
				const failures = Array.from(Cause.failures(cause));
				// TODO: handle multiple failures
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
		}),
		Effect.runPromise
	);

	if (result.type === 'success') {
		return result.response;
	}

	return error(result.status, { message: result.message });
};

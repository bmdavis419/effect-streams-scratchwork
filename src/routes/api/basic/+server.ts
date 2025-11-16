import { Console, Effect, Exit, pipe, Scope, Stream } from 'effect';
import { type RequestEvent } from '@sveltejs/kit';
import type { CharacterClassification } from '$lib/shared/types';
import * as Sse from '@effect/experimental/Sse';
import { waitUntil } from '@vercel/functions';
import { HttpServerResponse } from '@effect/platform';
import { betterBroadcastBodySchema } from '$lib/shared/schemas.js';
import { getAndValidateRequestBody, svelteEndpointWrapperEffect } from '$lib/endpoint-stuff';

const postEndpointEffect = (event: RequestEvent) =>
	Effect.gen(function* () {
		const { message } = yield* getAndValidateRequestBody(event, betterBroadcastBodySchema);

		const characters = message.split('');

		const baseStream = Stream.fromIterable(characters).pipe(
			Stream.mapEffect((c) => Effect.delay(Effect.succeed(c), '100 millis')),
			Stream.map<string, CharacterClassification>((c) => {
				const isVowel = /^[aeiou]$/i.test(c.toLowerCase());
				if (isVowel) {
					return {
						type: 'vowel',
						character: c
					};
				}

				const isConsonant = /^[bcdfghjklmnpqrstvwxyz]$/i.test(c.toLowerCase());
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

		const scope = yield* Scope.make();

		const [respStream, bgStream] = yield* Stream.broadcast(baseStream, 2, {
			capacity: 'unbounded'
		}).pipe(Scope.extend(scope));

		const bgRunner = Effect.forkIn(scope)(
			pipe(
				bgStream,
				Stream.runForEach((data) =>
					Console.log(`background stream: ${data.character} is a ${data.type}`)
				),
				Effect.ensuring(
					Effect.all([Scope.close(scope, Exit.void), Console.log('Background stream closed')])
				)
			)
		);

		yield* Effect.sync(() => waitUntil(Effect.runPromise(bgRunner)));

		const sseStreamResponse = pipe(
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
			Stream.encodeText,
			HttpServerResponse.stream,
			HttpServerResponse.toWeb
		);

		return sseStreamResponse;
	});

export const POST = async (event) => {
	return await svelteEndpointWrapperEffect(postEndpointEffect(event));
};

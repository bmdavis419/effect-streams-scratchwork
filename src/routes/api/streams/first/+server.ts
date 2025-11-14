import { Console, Effect, Exit, Fiber, pipe, Queue, Schema, Stream, Take } from 'effect';
import type { RequestEvent } from './$types';
import { error } from '@sveltejs/kit';
import type { CharacterClassification } from '$lib/shared/types';
import * as Sse from '@effect/experimental/Sse';
import { waitUntil } from '@vercel/functions';

const bodySchema = Schema.Struct({
	message: Schema.String
});

const getEffect = (event: RequestEvent) =>
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

		yield* Console.log(`message: ${message}`);

		const characters = message.split('');

		const baseStream = Stream.fromIterable(characters).pipe(
			Stream.mapEffect((c) => Effect.delay(Effect.succeed(c), '100 millis')),
			Stream.map<string, CharacterClassification>((c) => {
				console.log(`processing character: ${c}`);
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
			}),
			Stream.map(
				(data): Sse.Event => ({
					_tag: 'Event',
					event: 'data',
					id: undefined,
					data: JSON.stringify(data)
				})
			),
			Stream.map(Sse.encoder.write),
			Stream.toReadableStream()
		);

		return new Response(baseStream);
	});

export const POST = async (event) => {
	const result = await pipe(
		getEffect(event),
		Effect.exit,
		Effect.map((exit) =>
			Exit.match(exit, {
				onSuccess: (response) => {
					// waitUntil(Effect.runPromise(bgWork));
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

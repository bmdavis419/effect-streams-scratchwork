import { Console, Effect, Exit, pipe, Schema, Stream } from 'effect';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { CharacterClassification } from '$lib/shared/types';

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

		const [respConsumer, bgConsumer] = yield* Stream.broadcast(baseStream, 2, {
			capacity: 'unbounded'
		});

		yield* Stream.runForEach(bgConsumer, (item) =>
			Effect.gen(function* () {
				yield* Console.log(`IN RESP CONSUMER item: ${item.character}`);
			})
		).pipe(Effect.forkDaemon);

		const readableStream = pipe(
			respConsumer,
			Stream.tap((item) => Console.log(`IN TAP item: ${item.character}`)),
			Stream.toReadableStream
		);

		return message;
	});

export const POST = async (event) => {
	const result = await pipe(
		getEffect(event),
		Effect.exit,
		Effect.map((exit) =>
			Exit.match(exit, {
				onSuccess: (message) => {
					return {
						type: 'success' as const,
						message
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
		return new Response(result.message);
	}

	return error(result.status, { message: result.message });
};

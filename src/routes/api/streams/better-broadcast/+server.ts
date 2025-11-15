import { Cause, Console, Effect, Exit, Logger, pipe, Schema, Scope, Stream } from 'effect';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { CharacterClassification } from '$lib/shared/types';
import * as Sse from '@effect/experimental/Sse';
import { TaggedError } from 'effect/Data';
import { waitUntil } from '@vercel/functions';

class EndpointError extends TaggedError('EndpointError') {
	status: number;
	message: string;
	constructor(status: number, message: string) {
		super();
		this.status = status;
		this.message = message;
	}
}

const bodySchema = Schema.Struct({
	message: Schema.String
});

const getEffect = (event: RequestEvent) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const { message } = yield* pipe(
			Effect.tryPromise({
				try: () => event.request.json(),
				catch: (e) => new EndpointError(400, `Got invalid json: ${e}`)
			}),
			Effect.flatMap((body) =>
				Schema.decode(bodySchema)(body).pipe(
					Effect.mapError((e) => new EndpointError(400, `Failed to parse body: ${e.message}`))
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

		yield* Effect.logInfo('Starting broadcast stream');

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

		return new Response(sseStream);
	});

const svelteEndpointWrapperEffect = async (
	effect: Effect.Effect<Response, EndpointError, never>
): Promise<Response> => {
	const result = await pipe(
		effect,
		Effect.matchCause({
			onSuccess: (response) => {
				return {
					type: 'success' as const,
					response
				};
			},
			onFailure: (cause) => {
				const failures = Array.from(Cause.failures(cause));

				if (failures.length > 0) {
					const failure = failures[0];
					return {
						type: 'error' as const,
						status: failure.status,
						message: failure.message
					};
				}

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

export const POST = async (event) => {
	return await svelteEndpointWrapperEffect(getEffect(event));
};

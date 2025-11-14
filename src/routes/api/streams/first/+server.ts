import { Console, Effect, Exit, pipe, Schema } from 'effect';
import type { RequestEvent } from './$types';
import { error } from '@sveltejs/kit';

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

		yield* Console.log('got message', message);

		return new Response(message);
	});

export const POST = async (event) => {
	const result = await pipe(
		getEffect(event),
		Effect.exit,
		Effect.map((exit) =>
			Exit.match(exit, {
				onSuccess: (response) => ({
					type: 'success' as const,
					response
				}),
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

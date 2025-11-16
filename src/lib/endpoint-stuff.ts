import { error, type RequestEvent } from '@sveltejs/kit';
import { Cause, Effect, pipe, Schema } from 'effect';
import { TaggedError } from 'effect/Data';

export class EndpointError extends TaggedError('EndpointError') {
	status: number;
	message: string;
	constructor(status: number, message: string) {
		super();
		this.status = status;
		this.message = message;
	}
}

export const getAndValidateRequestBody = <A>(event: RequestEvent, schema: Schema.Schema<A>) =>
	pipe(
		Effect.tryPromise({
			try: () => event.request.json(),
			catch: (e) => new EndpointError(400, `Got invalid json: ${e}`)
		}),
		Effect.flatMap((body) =>
			Schema.decode(schema)(body).pipe(
				Effect.mapError((e) => new EndpointError(400, `Failed to parse body: ${e.message}`))
			)
		)
	);

export const svelteEndpointWrapperEffect = async (
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

	error(result.status, { message: result.message });
};

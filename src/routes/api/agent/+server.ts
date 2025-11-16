import { agentRequestBodySchema } from '$lib/shared/schemas';
import type { RequestEvent } from '@sveltejs/kit';
import { Effect, pipe, Stream } from 'effect';
import {
	EndpointError,
	getAndValidateRequestBody,
	svelteEndpointWrapperEffect
} from '$lib/endpoint-stuff';
import { encoder, type Event } from '@effect/experimental/Sse';
import { runQuestionAskerAgent } from '$lib/server/agent';
import { HttpServerResponse } from '@effect/platform';
import { RedisService } from '$lib/server/redis.js';

const postEndpointEffect = (event: RequestEvent) =>
	Effect.gen(function* () {
		const { question } = yield* getAndValidateRequestBody(event, agentRequestBodySchema);

		const stream = yield* runQuestionAskerAgent(question);

		const sseStreamResponse = pipe(
			stream,
			Stream.map(
				(data): Event => ({
					_tag: 'Event',
					event: 'data',
					id: undefined,
					data: JSON.stringify(data)
				})
			),
			Stream.map(encoder.write),
			Stream.encodeText,
			HttpServerResponse.stream,
			HttpServerResponse.toWeb
		);

		return sseStreamResponse;
	}).pipe(
		Effect.provide(RedisService.Default),
		Effect.catchTag('AgentError', (err) =>
			Effect.fail(new EndpointError(500, 'agent failed to run: ' + err.message))
		)
	);

export const POST = async (event) => {
	return await svelteEndpointWrapperEffect(postEndpointEffect(event));
};

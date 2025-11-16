import { agentRequestBodySchema } from '$lib/shared/schemas';
import type { RequestEvent } from '@sveltejs/kit';
import { Effect, pipe, Stream } from 'effect';
import {
	EndpointError,
	getAndValidateRequestBody,
	svelteEndpointWrapperEffect
} from '$lib/endpoint-stuff';
import { encoder, type Event } from '@effect/experimental/Sse';
import { resumeQuestionAskerAgent, runQuestionAskerAgent } from '$lib/server/agent';
import { HttpServerResponse } from '@effect/platform';

const getEndpointEffect = (event: RequestEvent) =>
	Effect.gen(function* () {
		const params = event.url.searchParams;

		const resumeKey = params.get('resumeKey');

		if (!resumeKey) {
			return yield* Effect.fail(new EndpointError(400, 'resumeKey is required'));
		}

		const stream = yield* resumeQuestionAskerAgent(resumeKey);

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
		Effect.catchTag('RedisError', (err) =>
			Effect.fail(new EndpointError(500, 'redis failed to resume agent: ' + err.message))
		)
	);

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
		Effect.catchTag('AgentError', (err) =>
			Effect.fail(new EndpointError(500, 'agent failed to run: ' + err.message))
		)
	);

export const POST = async (event) => {
	return await svelteEndpointWrapperEffect(postEndpointEffect(event));
};

export const GET = async (event) => {
	return await svelteEndpointWrapperEffect(getEndpointEffect(event));
};

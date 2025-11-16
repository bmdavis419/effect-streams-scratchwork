<script lang="ts">
	import { makeParser } from '@effect/experimental/Sse';
	import { BrowserHttpClient } from '@effect/platform-browser';
	import { HttpBody, HttpClient } from '@effect/platform';
	import { Effect, Fiber, pipe, Stream } from 'effect';
	import type { CharacterClassification } from '$lib/shared/types';
	import { betterBroadcastBodySchema } from '$lib/shared/schemas';

	let curFiber = $state<Fiber.RuntimeFiber<void, never> | null>(null);
	const isStreamRunning = $derived(curFiber !== null);

	let totalVowels = $state(0);
	let totalConsonants = $state(0);
	let totalOther = $state(0);
	const total = $derived(totalVowels + totalConsonants + totalOther);

	const callBetterBroadcast = Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;
		const body = yield* HttpBody.jsonSchema(betterBroadcastBodySchema)({
			message: 'This is a test...'
		});
		const response = yield* client.post('/api/basic', {
			body
		});

		if (response.status !== 200) {
			const body = (yield* response.json) as { message: string };
			return yield* Effect.fail(new Error(body.message));
		}

		const parser = makeParser((event) => {
			if (event._tag === 'Event') {
				const data = JSON.parse(event.data) as CharacterClassification;
				switch (data.type) {
					case 'vowel':
						totalVowels++;
						break;
					case 'consonant':
						totalConsonants++;
						break;
					case 'other':
						totalOther++;
						break;
				}
			}
		});

		yield* Stream.decodeText(response.stream).pipe(
			Stream.runForEach((event) => Effect.sync(() => parser.feed(event)))
		);
	}).pipe(
		Effect.provide(BrowserHttpClient.layerXMLHttpRequest),
		Effect.matchCause({
			onSuccess: () => console.log('Success'),
			onFailure: (cause) => console.error('hit failure', cause)
		}),
		Effect.ensuring(
			Effect.sync(() => {
				console.log('Stream ended');
				curFiber = null;
			})
		)
	);

	const handleStartStream = () => {
		totalVowels = 0;
		totalConsonants = 0;
		totalOther = 0;
		curFiber = pipe(callBetterBroadcast, Effect.runFork);
	};

	const handleStopStream = async () => {
		if (curFiber) {
			await pipe(curFiber, Fiber.interrupt, Effect.runPromise);
			curFiber = null;
		}
	};
</script>

<main class="flex grow flex-col items-center justify-center gap-4">
	<p class="text-neutral-200">STATUS: {isStreamRunning ? 'RUNNING' : 'NOT RUNNING'}</p>

	<button
		onclick={handleStartStream}
		class="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
		disabled={isStreamRunning}>Fetch Better Broadcast Stream</button
	>
	<button
		onclick={handleStopStream}
		class="rounded-md bg-red-500 px-4 py-2 text-white disabled:opacity-50"
		disabled={!isStreamRunning}>Abort</button
	>

	<p class="text-neutral-200">Total vowels: {totalVowels}</p>
	<p class="text-neutral-200">Total consonants: {totalConsonants}</p>
	<p class="text-neutral-200">Total other: {totalOther}</p>
	<p class="text-neutral-200">Total: {total}</p>
</main>

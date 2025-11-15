<script lang="ts">
	import logo from '$lib/assets/favicon.svg';
	import type { CharacterClassification } from '$lib/shared/types';
	import { makeChannel } from '@effect/experimental/Sse';
	import { Channel, Console, Effect, pipe, Stream } from 'effect';

	let abortController: AbortController | null = null;

	const callTestStreamEffect = (endpoint: string) =>
		Effect.gen(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					abortController = new AbortController();
					const resBody = yield* pipe(
						Effect.tryPromise({
							try: () =>
								fetch(endpoint, {
									method: 'POST',
									body: JSON.stringify({
										message: 'this is pain'
									}),
									signal: abortController?.signal
								}),
							catch: (e) => {
								return new Error(`Failed to fetch first stream: ${e}`);
							}
						}),
						Effect.flatMap((response) => {
							if (!response.ok || !response.body) {
								return Effect.fail(new Error('Failed to fetch first stream'));
							}
							return Effect.succeed(response.body);
						})
					);

					const channel = makeChannel();

					const stream = Stream.fromReadableStream({
						evaluate: () => resBody,
						onError: (e) => {
							return new Error(`Failed to create stream from readable stream: ${e}`);
						}
					});

					// doing this because the generics are not getting passed correctly in a pipe from the original stream
					const parsedStream = pipe(
						Stream.decodeText(stream),
						Stream.toChannel,
						(ch) => Channel.pipeTo(ch, channel),
						Stream.fromChannel,
						Stream.map((event) => JSON.parse(event.data) as CharacterClassification)
					);

					yield* pipe(
						parsedStream,
						Stream.runForEach((event) => Console.log(`${event.character} is a ${event.type}`))
					);
				})
			);
		});

	const handleFetchFirstStream = async () => {
		try {
			await Effect.runPromise(callTestStreamEffect('/api/streams/basic'));
		} catch (e) {
			console.error(e);
		}
	};
	const handleFetchBroadcastStream = async () => {
		try {
			await Effect.runPromise(callTestStreamEffect('/api/streams/broadcast'));
		} catch (e) {
			console.error(e);
		}
	};

	const handleFetchBroadcastStream2 = async () => {
		try {
			await Effect.runPromise(callTestStreamEffect('/api/streams/broadcast2'));
		} catch (e) {
			console.error(e);
		}
	};
</script>

<main class="flex grow flex-col items-center justify-center gap-4">
	<div class="flex flex-row items-center justify-center gap-2">
		<img src={logo} alt="Logo" class="h-24 w-24" />
		<h2 class="text-3xl font-bold"><span class="text-primary">SvelteKit</span> App</h2>
	</div>
	<p class="text-center text-lg text-neutral-500">We're doing some testing here...</p>

	<button onclick={handleFetchFirstStream} class="rounded-md bg-primary px-4 py-2 text-white"
		>Fetch First Stream</button
	>
	<button onclick={handleFetchBroadcastStream} class="rounded-md bg-primary px-4 py-2 text-white"
		>Fetch Broadcast Stream</button
	>

	<button onclick={handleFetchBroadcastStream2} class="rounded-md bg-primary px-4 py-2 text-white"
		>Fetch Broadcast Stream 2</button
	>
	<button
		onclick={() => abortController?.abort()}
		class="rounded-md bg-red-500 px-4 py-2 text-white">Abort</button
	>
</main>

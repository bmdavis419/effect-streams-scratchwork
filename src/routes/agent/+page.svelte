<script lang="ts">
	import { useSearchParams } from 'runed/kit';
	import { marked } from 'marked';
	import z from 'zod';
	import type { AgentChunk, ToolsWithInputOutput } from '$lib/server/agent';
	import { Effect, Fiber, pipe, Stream } from 'effect';
	import { HttpBody, HttpClient } from '@effect/platform';
	import { agentRequestBodySchema } from '$lib/shared/schemas';
	import { makeParser } from '@effect/experimental/Sse';
	import { BrowserHttpClient } from '@effect/platform-browser';

	const searchParamsSchema = z.object({
		question: z.string().default(''),
		resumeKey: z.string().default('')
	});

	type QuestionConversationDisplay =
		| {
				role: 'user';
				content: string;
		  }
		| {
				role: 'assistant';
				id: string;
				content: string;
				parsedContent: string;
		  }
		| {
				role: 'tool';
				id: string;
				tool: ToolsWithInputOutput | null;
		  };

	const params = useSearchParams(searchParamsSchema);
	let conversation = $state<QuestionConversationDisplay[]>([]);
	let curFiber = $state<Fiber.RuntimeFiber<void, never> | null>(null);
	let isLoading = $derived(curFiber !== null);
	let question = $derived(params.question);
	let resumeKey = $derived(params.resumeKey);
	const trimmedQuestion = $derived(question.trim());

	const resumeAgentEffect = Effect.gen(function* () {
		console.log('RESUMING AGENT', resumeKey);
		if (!resumeKey) return;

		const client = yield* HttpClient.HttpClient;
		const response = yield* client.get(`/api/agent?resumeKey=${resumeKey}`);

		if (response.status !== 200) {
			return yield* Effect.fail(new Error('Failed to resume agent'));
		}

		const parser = makeParser((event) => {
			if (event._tag !== 'Event') return;

			const chunk = JSON.parse(event.data) as AgentChunk;

			console.log('FROM RESUME:', chunk.type);
		});

		yield* Stream.decodeText(response.stream).pipe(
			Stream.runForEach((event) => Effect.sync(() => parser.feed(event)))
		);
	}).pipe(Effect.provide(BrowserHttpClient.layerXMLHttpRequest));

	const questionAgentEffect = Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;

		const body = yield* HttpBody.jsonSchema(agentRequestBodySchema)({
			question: trimmedQuestion
		});

		const response = yield* client.post('/api/agent', {
			body
		});

		if (response.status !== 200) {
			const body = (yield* response.json) as { message: string };
			return yield* Effect.fail(new Error(body.message));
		}

		const parser = makeParser((event) => {
			if (event._tag !== 'Event') return;

			const chunk = JSON.parse(event.data) as AgentChunk;

			switch (chunk.type) {
				case 'SPECIAL_START_CHUNK':
					params.resumeKey = chunk.id;
					handleResume();
					break;
				case 'text-start':
					conversation.push({
						role: 'assistant',
						id: chunk.id,
						content: '',
						parsedContent: ''
					});
					break;
				case 'text-delta':
					const existingAssistant = conversation.find(
						(c) => c.role === 'assistant' && c.id === chunk.id
					);
					if (existingAssistant && existingAssistant.role === 'assistant') {
						const newContent = existingAssistant.content + chunk.text;
						existingAssistant.content = newContent;
						existingAssistant.parsedContent = marked.parse(newContent, { async: false });
					}
					break;
				case 'tool-input-start':
					conversation.push({
						role: 'tool',
						id: chunk.id,
						tool: null
					});
					break;
				case 'tool-result':
					if (chunk.dynamic) break;
					const existingTool = conversation.find(
						(c) => c.role === 'tool' && c.id === chunk.toolCallId
					);
					if (existingTool && existingTool.role === 'tool') {
						existingTool.tool = {
							name: chunk.toolName,
							input: chunk.input,
							output: chunk.output
						};
					}
					break;
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

	const handleClear = () => {
		conversation = [];
		params.update({ question: '', resumeKey: '' });
	};

	const handleAsk = () => {
		if (!trimmedQuestion || isLoading) return;
		conversation = [];
		conversation.push({
			role: 'user',
			content: trimmedQuestion
		});
		curFiber = pipe(questionAgentEffect, Effect.runFork);
	};

	const handleResume = async () => {
		// TODO: this should work with the fiber...

		await resumeAgentEffect.pipe(Effect.runPromise);
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleAsk();
		}
	};

	const handleInput = (
		e: Event & {
			currentTarget: EventTarget & HTMLTextAreaElement;
		}
	) => {
		params.question = e.currentTarget.value;
	};

	const handleTextareaChange = (
		e: Event & {
			currentTarget: EventTarget & HTMLTextAreaElement;
		}
	) => {
		const textarea = e.currentTarget;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	};
</script>

<div class="mx-auto flex min-h-screen w-4xl flex-col">
	<div class="flex-1 overflow-y-auto p-6 pb-32">
		<div class=" mx-auto max-w-4xl">
			<h1 class="mb-8 text-left text-3xl font-bold text-white">Question Asker Demo</h1>

			{#each conversation as message, index (message.role === 'user' ? `user-${index}` : message.id)}
				{#if message.role === 'user'}
					<div class="mb-6">
						<div class="rounded-lg border-2 border-neutral-800 p-6">
							<p class="whitespace-pre-wrap text-neutral-100">{message.content}</p>
						</div>
					</div>
				{:else if message.role === 'assistant'}
					<div class="mb-6">
						<div class="prose max-w-none rounded-lg bg-neutral-800 p-6 prose-invert">
							{#if message.content}
								{@html message.parsedContent}
							{:else}
								<div class="text-neutral-400 italic">Thinking...</div>
							{/if}
						</div>
					</div>
				{:else if message.role === 'tool'}
					{#if !message.tool}
						<div class="mb-6">
							<div class="rounded-lg bg-neutral-800 p-6">
								<p class="whitespace-pre-wrap text-neutral-100">
									Tool call received. Waiting for result...
								</p>
							</div>
						</div>
					{:else}
						{@const isWriteMemory = message.tool.name === 'write_memory'}
						{@const memoryInput =
							isWriteMemory &&
							typeof message.tool.input === 'object' &&
							message.tool.input !== null &&
							'memory' in message.tool.input &&
							typeof message.tool.input.memory === 'string'
								? message.tool.input.memory
								: null}
						<div class="mb-6">
							<div class="rounded-lg border border-neutral-600 bg-neutral-700 p-4">
								<div class="mb-2 text-sm text-neutral-300">
									<span class="font-semibold">Tool:</span>
									{message.tool.name}
								</div>
								<details class="text-sm">
									<summary class="cursor-pointer text-neutral-400 hover:text-neutral-300">
										View details
									</summary>
									<div class="mt-2 space-y-2">
										{#if isWriteMemory && memoryInput}
											<div>
												<span class="text-neutral-400">Memory:</span>
												<div
													class="prose prose-sm mt-1 max-w-none rounded bg-neutral-800 p-2 prose-invert"
												>
													{@html marked.parse(memoryInput, { async: false })}
												</div>
											</div>
										{:else}
											<div>
												<span class="text-neutral-400">Input:</span>
												<pre
													class="mt-1 overflow-x-auto rounded bg-neutral-800 p-2 text-neutral-200">
													{JSON.stringify(message.tool.input, null, 2)}
												</pre>
											</div>
											<div>
												<span class="text-neutral-400">Output:</span>
												<pre
													class="mt-1 overflow-x-auto rounded bg-neutral-800 p-2 text-neutral-200">
													{JSON.stringify(message.tool.output, null, 2)}
												</pre>
											</div>
										{/if}
									</div>
								</details>
							</div>
						</div>
					{/if}
				{/if}
			{/each}
		</div>
	</div>

	<div class="fixed right-0 bottom-0 left-0 border-t border-neutral-700 bg-neutral-900 p-4">
		<div class="mx-auto flex max-w-4xl gap-3">
			<textarea
				value={question}
				oninput={handleInput}
				onchange={handleTextareaChange}
				onkeydown={handleKeyDown}
				placeholder="Ask a question..."
				class="flex-1 resize-none overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
				rows={1}
				style="min-height: 48px; max-height: 200px"
			></textarea>
			<button
				onclick={handleAsk}
				disabled={!trimmedQuestion || isLoading}
				class="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{isLoading ? 'Asking...' : 'Ask'}
			</button>
			<button
				onclick={handleClear}
				disabled={isLoading}
				class="rounded-lg bg-neutral-700 px-6 py-3 font-medium text-white transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				Clear
			</button>
		</div>
	</div>
</div>

import { OPENROUTER_API_KEY } from '$env/static/private';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
	stepCountIs,
	streamText,
	tool,
	type AsyncIterableStream,
	type Tool,
	type ToolSet
} from 'ai';
import { Effect, Stream } from 'effect';
import { TaggedError } from 'effect/Data';
import z from 'zod';

const openrouter = createOpenRouter({
	apiKey: OPENROUTER_API_KEY
});

const writeMemoryTool = tool({
	name: 'write_memory',
	description: 'Save a memory to the database',
	inputSchema: z.object({
		memory: z.string().describe(`Should be formatted as markdown in the following format:
         # {Memory < 10 word description} 
  
         **{Date}**
  
         ### Question
         {Question}
  
         ### Answer
         {Answer}
  
         ### Thoughts
         {Thoughts}
          `)
	}),
	execute: async ({ memory }) => {
		console.log('saving memory to database');
		console.log(memory);
		return {
			success: true,
			memory
		};
	}
});

const tools = {
	write_memory: writeMemoryTool
} satisfies ToolSet;

type Tools = typeof tools;

export type ToolsWithInputOutput = {
	[K in keyof Tools]: Tools[K] extends Tool<infer Input, infer Output>
		? {
				name: K;
				input: Input;
				output: Output;
			}
		: never;
}[keyof Tools];

const questionAskerAgent = ({ question }: { question: string }) => {
	const { fullStream } = streamText({
		model: openrouter('anthropic/claude-haiku-4.5'),
		prompt: question,
		tools,
		stopWhen: stepCountIs(5),
		system: `You are a helpful assistant who's job is to answer whatever questions the user asks. You also have access to a tool which allows you to save memories to the database. You should save a memory for every question that includes the following: the question, your answer, the date it was asked, and what you thought about it. Is there anything else you would want to know about the user? How could the question be improved? These are all things that only you will see and should be saved to the database. NEVER TELL THE USER THAT YOU ARE SAVING MEMORIES TO THE DATABASE, JUST DO IT.
        
        HELPFUL INFO:
        today's date is ${new Date().toISOString().split('T')[0]}
        `
	});

	return fullStream;
};

type ExtractAgentChunkType<T> = T extends AsyncIterableStream<infer U> ? U : never;

export type AgentChunk = ExtractAgentChunkType<ReturnType<typeof questionAskerAgent>>;

class AgentError extends TaggedError('AgentError') {
	cause: unknown;
	constructor(cause: unknown) {
		super();
		this.cause = cause;
	}
}

export const runQuestionAskerAgent = (question: string) =>
	Effect.gen(function* () {
		const rawStream = yield* Effect.try({
			try: () => questionAskerAgent({ question }),
			catch: (error) => new AgentError(error)
		});

		const stream = Stream.fromAsyncIterable(rawStream, (e) => new AgentError(e));

		// TODO: split this boy into redis...

		return stream;
	});

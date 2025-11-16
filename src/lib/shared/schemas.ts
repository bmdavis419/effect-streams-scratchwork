import { Schema } from 'effect';

export const betterBroadcastBodySchema = Schema.Struct({
	message: Schema.String.pipe(Schema.minLength(1))
});

export const agentRequestBodySchema = Schema.Struct({
	question: Schema.String.pipe(Schema.minLength(1))
});

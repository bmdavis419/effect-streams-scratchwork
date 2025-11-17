# Resumable Streams with Effect, Redis, and SvelteKit

Built this to test what it would be like to write the core off [river](https://github.com/bmdavis419/river) in effect.

I am fully convinced, this is absolutely the right way to do it. Effect's `ensuring` stuff makes handling cleanup, aborting, canceling, errors, and more SO much easier.

## todo

I would eventually like to figure out a really clean way of canceling the stream fully. Not just aborting the consumption, but stopping the stream that's running in the background...

## everything interesting:

- the agent logic is in [src/lib/server/agent.ts](src/lib/server/agent.ts)
- the redis durable stuff is in [src/lib/server/redis.ts](src/lib/server/redis.ts)
- the endpoints for the agent are in [src/routes/api/agent](src/routes/api/agent/+server.ts)

The scopes make this so much easier to reason about than raw web streams. For example in the agent resuming effect, we make a scope. Then pass it into the redis subscription effect. This way, when the scope is closed, the redis subscription is also closed. And it will automatically get cleaned up when the request is aborted or the page is navigated away from or the stream is finished, all because of:

```ts
Stream.ensuring(
    Effect.gen(function* () {
        yield* Effect.logInfo('RESUME SCOPE IS CLOSING');
        yield* Scope.close(scope, Exit.void);
    })
)
```

The amount of pain this saves is absurd...

## running this project locally

0. clone the repo

1. create a `.env.local` file with the following:

```
# get this from railway, upstash, local, or whatever you prefer
REDIS_URL=...

# get it from openrouter
OPENROUTER_API_KEY=...
```

2. install deps `bun i`

3. run the project `bun dev`

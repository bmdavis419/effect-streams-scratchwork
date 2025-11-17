# Resumable Streams with Effect, Redis, and SvelteKit

Built this to test what it would be like to write the core off [river](https://github.com/bmdavis419/river) in effect.

I am fully convinced, this is absolutely the right way to do it. Effect's `ensuring` stuff makes handling cleanup, aborting, canceling, errors, and more SO much easier.

## everything interesting:

- the redis storage is in [src/lib/server/agent.ts](src/lib/server/agent.ts)

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

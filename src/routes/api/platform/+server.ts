// TODO: make an api endpoint here with effect.ts and platform bun...

import { HttpRouter, HttpServer, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

const router = HttpRouter.empty.pipe(
	HttpRouter.get(
		'/api/platform',
		Effect.gen(function* () {
			return HttpServerResponse.text('Hello, world!');
		})
	)
);

const handler = HttpServer.serveEffect(router);

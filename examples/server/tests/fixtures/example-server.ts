import { randomUUID } from "node:crypto";

import { startExampleRpcServer } from "@effect-api-query/server";
import { Context, Effect, Layer, Scope } from "effect";

import { ExampleDomain } from "../../src/domain.ts";

export const startExampleServerFixture = Effect.fn("startExampleServerFixture")(
  function* startFixture() {
    const scope = yield* Scope.Scope;
    const context = yield* Layer.buildWithScope(ExampleDomain.layer, scope);
    const { users, diagnostics, commands } = Context.get(
      context,
      ExampleDomain
    );
    const writeToken = randomUUID();
    const server = yield* startExampleRpcServer({
      writeToken,
      domainLayer: Layer.succeedContext(context),
    });
    return {
      server,
      writeToken,
      seed: users.seed,
      reset: Effect.gen(function* resetFixture() {
        yield* commands.reset;
        yield* diagnostics.reset;
        yield* users.reset;
      }),
    };
  }
);

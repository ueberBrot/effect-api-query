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
    const server = yield* startExampleRpcServer({
      domainLayer: Layer.succeedContext(context),
    });
    return {
      server,
      seed: users.seed,
      reset: Effect.gen(function* resetFixture() {
        yield* commands.reset;
        yield* diagnostics.reset;
        yield* users.reset;
      }),
    };
  }
);

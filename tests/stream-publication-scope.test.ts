import { Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamPublicationBatches } from "#effect-api-query/core/stream-publication";

describe(streamPublicationBatches, () => {
  it("interrupts an in-flight no-deadline publication pull when its scope closes", async () => {
    await Effect.runPromise(
      Effect.gen(function* interruptsPullOnScopeClose() {
        const entered = yield* Deferred.make<undefined>();
        const source: Stream.Stream<number> = Stream.fromEffect(
          Effect.gen(function* blockOnSource() {
            yield* Deferred.succeed(entered, undefined);
            return yield* Effect.never;
          })
        );

        const scope = yield* Scope.make();
        const pull = yield* Stream.toPull(
          streamPublicationBatches(source, 2)
        ).pipe(Effect.provideService(Scope.Scope, scope));

        const pullFiber = yield* Effect.forkChild(pull, {
          startImmediately: true,
        });
        yield* Deferred.await(entered);
        yield* Scope.close(scope, Exit.void);

        const exit = yield* Fiber.await(pullFiber);
        expect(Exit.isFailure(exit)).toBe(true);
      })
    );
  });
});

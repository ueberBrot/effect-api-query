import {
  runQueryEvents,
  queryEffects,
  type QueryOwner,
  type QueryClientOperationError,
} from "@ueberbrot/effect-api-query";
import { Effect, Stream, Context, Layer, ManagedRuntime } from "effect";

import { directoryEffects } from "../../examples/shared/query-effects";

declare const owner: QueryOwner<unknown>;
declare const rpc: ReturnType<typeof directoryEffects>["rpc"];
const events = Stream.make({ id: 1, name: "Ada" });
const completion = runQueryEvents(
  owner,
  events,
  {
    onEvent: (event) =>
      Effect.gen(function* () {
        yield* queryEffects.setData(
          rpc.users.read.queryKey({ input: { id: event.id } }),
          event
        );
        yield* queryEffects.invalidate(
          rpc.users.read.queryFilter({ view: "query", refetchType: "none" })
        );
      }),
  },
  Effect.runPromiseExit
);
const wrong = queryEffects.setData(
  rpc.users.read.queryKey({ input: { id: 1 } }),
  // @ts-expect-error Generated keys retain decoded user data in event mappings
  { id: 1, name: 123 }
);

class Domain extends Context.Service<Domain, { readonly name: string }>()(
  "Events/Domain"
) {}
const needsDomain = { onEvent: () => Effect.asVoid(Domain) };
const runtime = ManagedRuntime.make(Layer.succeed(Domain, { name: "test" }));
const withDomain = runQueryEvents(owner, events, needsDomain, runtime);
type Assert<T extends true> = T;
type ErrorContract = Assert<
  typeof completion extends Promise<
    import("effect").Exit.Exit<void, QueryClientOperationError>
  >
    ? true
    : false
>;

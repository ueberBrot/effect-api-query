import {
  runQueryEvents,
  queryEffects,
  createQueryFilter,
  type QueryOwner,
  type QueryClientOperationError,
} from "@ueberbrot/effect-api-query";
import { Effect, Stream, Context } from "effect";

import { directoryEffects } from "../../examples/shared/query-effects";

declare const owner: QueryOwner<unknown>;
declare const rpc: ReturnType<typeof directoryEffects>["rpc"];
const reads = createQueryFilter(rpc.users.read, "query");
const events = Stream.make({ id: 1, name: "Ada" });
export const completion = runQueryEvents(
  owner,
  events,
  {
    onEvent: (event) =>
      Effect.gen(function* () {
        yield* queryEffects.setData(
          rpc.users.read.queryKey({ id: event.id }),
          event
        );
        yield* queryEffects.invalidate({ ...reads(), refetchType: "none" });
      }),
  },
  Effect.runPromiseExit
);
const wrong = queryEffects.setData(
  rpc.users.read.queryKey({ id: 1 }),
  // @ts-expect-error Generated keys retain decoded user data in event mappings
  { id: 1, name: 123 }
);
export { wrong };
class Domain extends Context.Service<Domain, { readonly name: string }>()(
  "Events/Domain"
) {}
const needsDomain = { onEvent: () => Effect.asVoid(Domain) };
export const withDomain = runQueryEvents(
  owner,
  events,
  needsDomain,
  (effect, options) =>
    Effect.runPromiseExit(
      effect.pipe(Effect.provideService(Domain, { name: "test" })),
      options
    )
);
type Assert<T extends true> = T;
export type ErrorContract = Assert<
  typeof completion extends Promise<
    import("effect").Exit.Exit<void, QueryClientOperationError>
  >
    ? true
    : false
>;

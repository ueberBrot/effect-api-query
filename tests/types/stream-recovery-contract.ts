import { recoverStream } from "@ueberbrot/effect-api-query";
import type {
  RecoverStreamOptions,
  StreamConnectionState,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

class RecoveryService extends Context.Service<
  RecoveryService,
  { readonly cursor: number }
>()("RecoveryService") {}
interface Event {
  readonly cursor: number;
  readonly message: string;
}
declare const connect: (
  cursor: number
) => Stream.Stream<Event, Error, RecoveryService>;

const options = {
  connect,
  cursor: (event: Event) => event.cursor,
  retryDelay: (_cause, attempt) => (attempt <= 3 ? "100 millis" : undefined),
  onReplayExpired: () =>
    RecoveryService.pipe(Effect.map((service) => service.cursor)),
  onGap: (_previous, _next) => Effect.void,
  onState: (state) =>
    Effect.sync(() => {
      state satisfies StreamConnectionState<Error>;
    }),
} satisfies RecoverStreamOptions<Event, Error, RecoveryService>;

const recovered = recoverStream(options) satisfies Stream.Stream<
  Event,
  Error,
  RecoveryService
>;

const inferred = recoverStream({
  connect,
  cursor: (event) => event.cursor,
  retryDelay: () => undefined,
}) satisfies Stream.Stream<Event, Error, RecoveryService>;
const invalidCursor = recoverStream({
  connect,
  // @ts-expect-error Recovery cursors use one ordered numeric sequence.
  cursor: (event) => event.message,
  retryDelay: () => undefined,
});
// @ts-expect-error Recovery preserves connection requirements.
const missingService = recoverStream(options) satisfies Stream.Stream<
  Event,
  Error
>;

const group = RpcGroup.make(
  Rpc.make("events.watch", {
    payload: { feed: Schema.String, after: Schema.Int },
    success: Schema.Struct({ cursor: Schema.Int, message: Schema.String }),
    stream: true,
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const delivery = recoverStream({
  connect: (after) => client("events.watch", { feed: "news", after }),
  cursor: (event) => event.cursor,
  retryDelay: (_cause, attempt) =>
    attempt <= 3 ? Math.min(250 * 2 ** (attempt - 1), 5_000) : undefined,
});
const nativeDelivery = delivery satisfies Stream.Stream<Event>;

class GapService extends Context.Service<GapService, {}>()("GapService") {}
class RefreshService extends Context.Service<RefreshService, {}>()(
  "RefreshService"
) {}
class StateService extends Context.Service<StateService, {}>()(
  "StateService"
) {}
declare const opaqueConnect: (
  cursor: string
) => Stream.Stream<Event, "offline", RecoveryService>;
const opaque = recoverStream({
  connect: opaqueConnect,
  initialCursor: "start",
  cursor: (event) => event.message,
  cursorPolicy: {
    accept: (previous, next) => previous !== next,
    isGap: (previous, next) => previous === "a" && next === "c",
  },
  retryDelay: (cause) => {
    cause satisfies import("effect").Cause.Cause<"offline" | "gap" | "refresh">;
    return undefined;
  },
  onGap: () => GapService.pipe(Effect.andThen(Effect.fail("gap" as const))),
  onReplayExpired: () =>
    RefreshService.pipe(Effect.andThen(Effect.fail("refresh" as const))),
  onState: (state) => {
    state satisfies StreamConnectionState<
      "offline" | "gap" | "refresh",
      string
    >;
    return StateService.pipe(Effect.asVoid);
  },
});
const completeOpaque = opaque satisfies Stream.Stream<
  Event,
  "offline" | "gap" | "refresh",
  RecoveryService | GapService | RefreshService | StateService
>;
// @ts-expect-error Gap and refresh failures remain in the public failure channel.
const missingHookFailure = opaque satisfies Stream.Stream<
  Event,
  "offline",
  RecoveryService | GapService | RefreshService | StateService
>;
// @ts-expect-error State callback requirements remain in the public environment.
const missingStateService = opaque satisfies Stream.Stream<
  Event,
  "offline" | "gap" | "refresh",
  RecoveryService | GapService | RefreshService
>;
// @ts-expect-error Opaque cursors require an explicit initial cursor and acceptance policy.
const missingOpaquePolicy = recoverStream({
  connect: opaqueConnect,
  cursor: (event: Event) => event.message,
  retryDelay: () => undefined,
});

declare const annotatedNumeric: RecoverStreamOptions<
  Event,
  Error,
  RecoveryService
>;
const numericAnnotation = recoverStream(
  annotatedNumeric
) satisfies Stream.Stream<Event, Error, RecoveryService>;
declare const annotatedOpaque: RecoverStreamOptions<
  Event,
  Error,
  RecoveryService,
  string
>;
const opaqueAnnotation = recoverStream(annotatedOpaque) satisfies Stream.Stream<
  Event,
  Error,
  RecoveryService
>;

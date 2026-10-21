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

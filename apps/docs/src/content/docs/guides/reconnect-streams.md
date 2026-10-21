---
title: Reconnect Streams
description: Resume application-owned Effect streams with ordered cursors, bounded retries, and visible connection state.
---

Use `recoverStream` when your server can replay decoded events after an accepted numeric cursor. It wraps an application-owned Effect Stream and reuses your ready RPC or HTTP API client. Keep one recovery consumption inside the captured owner's lifetime.

## Define the replay protocol

Use one increasing safe-integer sequence for each owner and source epoch. `initialCursor` defaults to zero; accepted events must have a greater cursor. Decode and validate event envelopes and verify their owner before the helper accepts their cursors. The server must authorize the requested feed and define how long replay remains available.

Decide how a gap and expired replay refresh authoritative reads. A refresh must provide a cursor that matches the refreshed state. Merely invalidating queries does not prove that reads completed or establish their replay position. If the source resets its sequence, retire the old consumption and start a new one for that epoch.

## Attach the ready client

This example assumes a ready flat RPC client whose `events.watch` operation accepts `feed` and `after`, and emits decoded objects with a numeric `cursor`. `consumer` is the captured domain-event consumer from [Refresh Reads from Domain Events](/effect-api-query/guides/refresh-from-events/).

Provide these application functions: `isReplayExpired` classifies the complete Cause; `refreshAndGetCursor` refreshes authoritative reads and returns their cursor; `refreshGap` refreshes affected reads before accepting a gap; and `setConnectionState` updates the owner's connection-state store.

```ts
import { recoverStream } from "@ueberbrot/effect-api-query";
import { Cause, Effect, Stream } from "effect";

const delivery = recoverStream({
  connect: (after) => client("events.watch", { feed: "news", after }),
  cursor: (event) => event.cursor,
  initialCursor: consumer.cursor(),
  retryDelay: (cause, attempt) =>
    Cause.hasDies(cause) || attempt > 3
      ? undefined
      : Math.min(250 * 2 ** (attempt - 1), 5000),
  isReplayExpired,
  onReplayExpired: refreshAndGetCursor,
  onGap: refreshGap,
  onState: (state) => Effect.sync(() => setConnectionState(state)),
});

const consume = delivery.pipe(Stream.runForEach(consumer.deliver));
```

Run `consume` in the captured owner's runtime and interrupt it when that owner retires. For HTTP SSE, make `connect` unwrap the ready client's returned stream and supply resume headers or query fields on each attempt. Connection calls and hooks retain their Effect error and service requirements. The [public compiler fixture](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/stream-recovery-contract.ts) shows native RPC composition and service inference.

Keep resume state inside `connect`. Generated read keys continue to identify stable logical reads. Passing a changing cursor to a generated stream builder changes its canonical input and creates different cache entries. This recipe consumes domain delivery and refreshes the existing query cache. Choose cached [stream views](/effect-api-query/guides/streaming/) separately.

## Bound retries and show connection state

`retryDelay(cause, attempt)` runs after local attempt cleanup and receives the complete Cause, including cleanup failures, and a one-based retry count across this consumption. The example allows three retries with capped exponential delay and stops on defects. Use your application's failure classifier to limit retries to recoverable failures. Return `undefined` to stop with the original Cause. Normal completion ends the stream.

`onState` receives `connecting`, `connected`, `backing-off`, `refreshing`, and terminal `completed`, `stopped`, or `failed` states. Each includes the accepted cursor. Attempt states include the zero-based connection attempt; backoff and refresh states include the failure Cause. `connected` means an event was accepted locally and is reported again as the cursor advances. Keep state callbacks short and free of failures.

Choose one retry owner. When an enclosing query uses recovery, set its native `retry` policy deliberately, commonly to `false`, and account for transport-level reconnect policies. Otherwise the layers can multiply attempts.

## Recover gaps and expired replay

Events at or below the accepted cursor are ignored. A newer cursor that skips a position calls `onGap(previous, next)` before acceptance, when that hook is supplied. Without the hook, the newer event is accepted. The helper advances its cursor before downstream event processing.

When `isReplayExpired` returns true and a retry remains, the helper waits for the retry delay, calls `onReplayExpired`, and reconnects with the returned cursor. Expired replay without that hook stops with the original failure. A failed refresh ends recovery with the refresh failure. Hook side effects follow the application's own retry and idempotency policy.

Cursor state belongs to each consumption. A new consumption starts from `initialCursor` again. Persist a checkpoint outside the helper when recovery must survive a restart. Local acceptance provides neither durable acknowledgement nor exactly-once delivery.

## Stop before replacing the owner

Interrupting the consuming Effect stops the active stream, backoff delay, or replay-refresh hook before another connection starts. Await local cleanup, then release the ready client, its Scope, and the runtime. The helper creates no transport or client lifetime of its own. Follow [Cancellation](/effect-api-query/guides/cancellation/#release-resources-after-local-cleanup) when replacement streams share exclusive resources, and [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) when authorization changes.

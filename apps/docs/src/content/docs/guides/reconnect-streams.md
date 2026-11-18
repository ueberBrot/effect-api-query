---
title: Reconnect Streams
description: Resume application-owned Effect streams with ordered cursors, bounded retries, and visible connection state.
---

Use `recoverStream` if your server can replay events after a cursor, the last accepted position in a feed. Run it with your ready client inside the current owner's lifetime.

## Define the replay protocol

The default policy expects an increasing safe-integer sequence for each owner and source epoch. `initialCursor` defaults to zero. Decode and check the event and its owner before the helper accepts its cursor. Your server authorizes the feed and defines how long replay is available.

If replay expires or skips a position, fetch current state and return the cursor that matches it. Invalidating queries only marks entries stale and can trigger refetches. It cannot provide that cursor. If the source resets its sequence, retire the old consumption and start one for the new epoch.

## Attach the ready client

This example uses a flat RPC client with `events.watch`. The operation takes `feed` and `after` and emits objects with numeric cursors. It uses the [domain-event consumer](/effect-api-query/guides/refresh-from-events/) as `consumer`.

Supply `isReplayExpired` to classify the Cause and `refreshAndGetCursor` to refresh state and return its cursor. Use `refreshGap` to refresh before accepting a gap. Use `setConnectionState` to update the owner's store.

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

Run `consume` in the owner's runtime. Interrupt it when the owner retires. For HTTP SSE or NDJSON, unwrap the ready client's stream in `connect` and pass resume headers or query fields on each attempt. Calls and hooks retain their Effect error and service requirements. See the [compiler fixture](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/stream-recovery-contract.ts).

Keep resume state in `connect`. Changing the cursor passed to a generated builder changes its key. This recipe updates existing reads from delivered events. See [streaming](/effect-api-query/guides/streaming/) to cache the feed itself.

## Use opaque replay IDs or another order

Pass `initialCursor` and `cursorPolicy` together. `accept(previous, next)` decides if the event can advance the cursor and reach consumers. For an accepted event, `isGap(previous, next)` can trigger `onGap` before advancement. Omit it if the protocol cannot detect gaps. The policy supplies all ordering and duplicate rules. Decode cursor objects before passing them in and keep them unchanged.

This protocol permits repeating the latest ID. The server sends `id-a` after `id-z`, so compare equality to suppress that repeat. If the protocol can replay older IDs, supply its ordering or acceptance rule.

```ts
import { recoverStream } from "@ueberbrot/effect-api-query";
import { Effect, Stream } from "effect";

const opaqueDelivery = recoverStream({
  initialCursor: "start",
  connect: (after: string) =>
    after === "start"
      ? Stream.succeed("id-z").pipe(Stream.concat(Stream.fail("offline")))
      : Stream.make("id-z", "id-a"),
  cursor: (id) => id,
  cursorPolicy: { accept: (previous, next) => previous !== next },
  retryDelay: (_cause, attempt) => (attempt === 1 ? 0 : undefined),
});
const ids = Effect.runPromise(Stream.runCollect(opaqueDelivery));
// Resolves to ["id-z", "id-a"].
```

The same policy supports structured IDs and decreasing or fractional positions. `StreamConnectionState<E, C>` retains your cursor type and defaults to `number`. The returned stream needs the services its callbacks use. A failed gap hook keeps the previous cursor and follows the retry policy. A failed refresh ends recovery with its complete Cause.

## Bound retries and show connection state

`retryDelay(cause, attempt)` runs after cleanup. It receives the complete Cause, including cleanup failures, and a one-based retry count. This example allows three retries with bounded backoff and stops on defects. Return `undefined` to stop with the original Cause. Normal completion also stops recovery.

`onState` reports `connecting`, `connected`, `backing-off`, `refreshing`, `completed`, `stopped`, or `failed`. Each state includes the accepted cursor. Attempt states add a zero-based connection attempt. Backoff and refresh add the Cause. The helper reports `connected` after each accepted event. Keep the callback short and infallible.

Set one retry policy for recovery. If a query wraps it, consider `retry: false` for that query and account for transport reconnects. Each layer that retries can multiply attempts.

## Recover gaps and expired replay

The numeric policy skips cursors at or below the current one. If a newer cursor skips a position, the helper runs `onGap` if provided. It then accepts the event. The cursor advances before the downstream handler processes the event.

When `isReplayExpired` returns true and a retry remains, the helper waits for the delay, calls `onReplayExpired`, and reconnects with the returned cursor. If the hook is absent, it stops with the original failure. If refresh fails, it stops with the refresh Cause. Make hook side effects safe to repeat under your app's policy.

Each consumption begins at `initialCursor`. Persist a checkpoint separately if it must survive a restart. Local acceptance confirms a cursor value only. Use an explicit protocol for durable acknowledgement.

## Stop before replacing the owner

Interrupt the consuming Effect to stop the stream, backoff, or replay refresh. Wait for local cleanup before releasing the client, its Scope, and its runtime. See [cancellation](/effect-api-query/guides/cancellation/#release-resources-after-local-cleanup) for shared resources and [cache owners](/effect-api-query/guides/switch-cache-owners/) when authorization changes.

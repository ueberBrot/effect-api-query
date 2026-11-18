---
title: Refresh Reads from Domain Events
description: Map domain delivery and Effect Reactivity to scoped native Query invalidation.
---

Map each delivered domain event to the reads it affects. If RPC and HTTP expose the same domain, map both because they use distinct cache roots.

Adapt the [user-event consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/user-events.ts) beside your client and write modules. Supply the captured owner, an Effect Reactivity service, and a decoded network stream.

## Map events to reads

The `users.v1` envelope includes the consumer's `ownerKey`, a positive safe-integer cursor, and an event kind.

| Event | Reads invalidated |
| --- | --- |
| `users.changed` | RPC and HTTP list/page prefixes, including infinite page entries. |
| `user.changed`, with `id` and `locale` | Those directory prefixes and both exact user-detail keys. |
| `users.reset` | Both complete user branches. |

A detail event targets one user and locale. Other details and diagnostic queries stay untouched. Generated keys use the owner's QueryClient hashing defaults. Define the mapping from domain events to keys in the app.

Put safe tenant, user, session, and permission-generation values into `ownerKey`. Authenticate the transport and confirm who can receive each event separately.

## Register one consumer for the owner

Import `makeUserEventConsumer`, `decodeUserEvent`, and `flush` from the example module. Import `Effect` and `Stream` from `effect`. Use the captured owner and its Reactivity service.

Inside the owner's Scope, acquire `consumer` with `yield* makeUserEventConsumer(owner, reactivity, { observedUsers: [{ id: 1, locale: 'en' }] })`. The consumer registers those detail mappings locally.

Attach the network stream in the same Scope. Its error and service requirements stay in the returned Effect.

```ts
const consume = <E, R>(events: Stream.Stream<unknown, E, R>) =>
  events.pipe(
    Stream.mapEffect((event) => decodeUserEvent(event)),
    Stream.runForEach(consumer.deliver),
    Effect.ensuring(Effect.promise(consumer.flush))
  );
```

Run `consume(events)` in the app runtime. The [typed example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-user-events.ts) rejects inactive or duplicate owners. Closing the Scope unregisters listeners. Late events cannot write to a replacement cache. Close the Scope, then cancel and drain started reads before releasing the clients. See [switch cache owners](/effect-api-query/guides/switch-cache-owners/).

## Coalesce local invalidation

Use the consumer's `reactivityKeys.directory`, `reactivityKeys.all`, or `reactivityKeys.user({ id, locale })`. Include every detail your local writers refresh in `observedUsers`. Network events can target any valid user.

Reactivity uses its own application keys. Register the mapping to TanStack query keys explicitly.

The consumer combines pending invalidations and lets broad ones cover narrower reads. It waits while its QueryClient has pending mutations, which protects optimistic writes. Apply the same rule to other refresh paths. `flush()` drains runnable work. Jobs report errors to `onRefreshError`; queries keep their native retry and error state.

See [optimistic writes](/effect-api-query/guides/optimistic-writes/) for overlapping mutations.

## Resume delivery deliberately

The example uses one increasing cursor per owner. It ignores previously accepted cursors. A gap queues a refresh of both user branches and advances the cursor. The cursor records an accepted invalidation request, which can precede a successful read.

Reconnect from `consumer.cursor()`. If the server can replay later events in order, call `consumer.resume(true)`. If it cannot, stop the old delivery and call `consumer.resume(false)` before accepting new events. This resets the cursor and refreshes both user branches.

A new Scope starts at cursor zero. Fetch authoritative data on startup. Invalid envelopes fail Schema decoding before changing the cursor. Your app controls backoff, replay retention, persistence, source epochs, and delivery guarantees.

If the server supports replay, [wrap the stream with recoverStream](/effect-api-query/guides/reconnect-streams/). Start from `consumer.cursor()` and deliver recovered events to the captured consumer.

`recoverStream` advances before downstream delivery. The consumer advances after accepting an invalidation request. Keep both under one owner. If replay expires, refresh state and return its matching cursor. A queued invalidation alone cannot establish that position.

## Choose a visible stream view

For complete state, use a live query. For recent changes, keep bounded history. An open `replace` stream keeps the previous history until it finishes. See [choose stream history](/effect-api-query/guides/choose-stream-history/).

To acquire, recover, and apply events within one owner, see [apply events to a scoped cache](/effect-api-query/guides/scoped-event-cache/).

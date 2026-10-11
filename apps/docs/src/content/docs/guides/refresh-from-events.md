---
title: Refresh Reads from Domain Events
description: Map domain delivery and Effect Reactivity to scoped native Query invalidation.
---

Use one application-owned consumer to map each domain event to the reads it changes. If RPC and
HTTP represent the same domain, name both adapters in the mapping. Their generated cache roots remain separate.

Copy [the user-event consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/user-events.ts)
next to your owner, write, and client modules. Adjust its local application imports. The consumer
takes the captured owner and an application-owned Effect Reactivity service. Supply your own
decoded network stream. The module creates no connection, broker, provider, or second cache.

## Map events to reads

The `users.v1` envelope includes the consumer's `ownerKey`, a positive safe-integer cursor, and one
of these event kinds:

| Event                                  | Reads invalidated                                                 |
| -------------------------------------- | ----------------------------------------------------------------- |
| `users.changed`                        | RPC and HTTP list/page prefixes, including infinite page entries. |
| `user.changed`, with `id` and `locale` | Those directory prefixes and both exact user-detail keys.         |
| `users.reset`                          | Both complete user branches.                                      |

Other user IDs, locales, and diagnostic branches remain untouched by an ordinary detail event.
Generated keys and native filters retain the owning QueryClient's global and prefix hash defaults.
The mapping depends on the domain relationship, so the package does not infer it from mutation or
event names.

The `ownerKey` contains safe tenant, user, session, and permission-generation identity. It
partitions event routing. The application must separately authenticate the transport and validate
which owner can receive each event.

## Register one consumer for the owner

`makeUserEventConsumer`, `decodeUserEvent`, and `flush` are application helpers from the linked
consumer module. Import `Effect` and `Stream` from `effect`. Provide the captured `owner` and
application `reactivity` service. Acquire the consumer once inside the owner's Effect Scope.

Acquire `consumer` with `yield* makeUserEventConsumer(owner, reactivity, { observedUsers:
[{ id: 1, locale: 'en' }] })`. This registers the owner's selected local detail mappings.

In that same scope, attach the supplied network stream with its existing service/error channels:

```ts
const consume = <E, R>(events: Stream.Stream<unknown, E, R>) =>
  events.pipe(
    Stream.mapEffect((event) => decodeUserEvent(event)),
    Stream.runForEach(consumer.deliver),
    Effect.ensuring(Effect.promise(consumer.flush)),
  )
```

Run `consume(events)` with the application's runtime. The
[complete typed attachment](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-user-events.ts)
shows composition. It rejects inactive or duplicate owners and unregisters listeners when the Scope closes.
A retired consumer ignores late delivery and cannot redirect it to a replacement QueryClient.
Close the consumer's Scope. Cancel and drain started reads. Release the clients before replacing the owner.
See [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/).

## Coalesce local invalidation

Use the consumer's `reactivityKeys.directory`, `reactivityKeys.all`, or
`reactivityKeys.user({ id, locale })` with Effect Reactivity. Exact local user mappings exist for
the `observedUsers` registered when the consumer starts. Include every detail read your local
writers must refresh. Delivered domain events can target any valid user.

These keys are stable application strings. Reactivity hashes its own keys. A TanStack query tuple
has no implied Reactivity subscription or prefix relationship. Register an explicit mapping
between the two systems.

The consumer combines invalidation requests, and broad refreshes cover narrower work.
It defers refresh while its captured QueryClient has pending mutations. This protects optimistic
writes. Other refresh paths need the same application policy. `flush()` drains runnable batches
and leaves requests queued during pending writes. Refresh-job errors go to `onRefreshError`.
Query errors retain native Query retry and state behavior.

See the linked consumer for its bookkeeping
bounds and [Optimistic User Writes](/effect-api-query/guides/optimistic-writes/) for overlap rules.

## Resume delivery deliberately

This recipe assumes one ordered, monotonically increasing cursor sequence per owner. It ignores
cursors already accepted. A gap queues a full user-branch refresh and advances the accepted cursor.
The cursor records accepted invalidation requests. It does not provide a durable acknowledgement
or establish that a read succeeded.

Reconnect using `consumer.cursor()` as the last accepted cursor. Call `consumer.resume(true)` when
the transport can replay subsequent events in order. Replayed duplicates remain harmless. If
replay is unavailable, call `consumer.resume(false)` before accepting the new sequence. That call
resets the cursor and refreshes both user branches. Stop delivery from the old connection first.

The application owns reconnect backoff, replay retention, cursor storage, source epochs, schema
migration, authorization, acknowledgements, and out-of-order delivery handling. A new owner Scope
starts at cursor zero. Fetch its authoritative reads on startup. This recipe does not promise
durable or exactly-once delivery. Invalid envelopes fail Schema decoding before changing the cursor.

## Choose a visible stream view

Use a live query for complete snapshots or bounded history for recent events. The latest delta
alone does not reconstruct state. An indefinitely open `replace` stream does not publish a
replacement before completion. See [Choose Stream History](/effect-api-query/guides/choose-stream-history/).

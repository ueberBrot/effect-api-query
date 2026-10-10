---
title: Refresh Reads from Domain Events
description: Map domain delivery and Effect Reactivity to scoped native Query invalidation.
---

Use one application-owned consumer to map a domain event to the reads it changes. The mapping
must name both adapters when RPC and HTTP represent the same domain: their generated cache roots
remain separate.

Copy [the user-event consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/user-events.ts)
next to your owner, write, and client modules, adjusting its local application imports. Its inputs are the captured owner and
an application-owned Effect Reactivity service. Supply your own decoded network stream; the module
creates no connection, broker, provider, or second cache.

## Register one consumer for the owner

Acquire the consumer once in the owner's Scope. The following attachment accepts a supplied
Effect Stream and preserves its failure and service requirements. Run its `consume` Effect with
your application runtime and keep that Scope open across transport reconnects.

```ts
import { Effect, Stream } from 'effect'
import type { Reactivity } from 'effect/reactivity'

import { decodeUserEvent, makeUserEventConsumer } from '../fixtures/user-events.ts'
import type { UserEventOwner } from '../fixtures/user-events.ts'

const attachUserEvents = Effect.fnUntraced(function* (
  owner: UserEventOwner,
  reactivity: Reactivity.Reactivity,
) {
  const consumer = yield* makeUserEventConsumer(owner, reactivity, {
    observedUsers: [{ id: 1, locale: 'en' }],
  })
  const consume = <E, R>(events: Stream.Stream<unknown, E, R>) =>
    events.pipe(
      Stream.mapEffect((event) => decodeUserEvent(event)),
      Stream.runForEach(consumer.deliver),
      Effect.ensuring(Effect.promise(consumer.flush)),
    )
  return {
    consumer,
    consume,
    latestDiagnostic: owner.rpcQuery.diagnostics.stream.liveOptions(),
    diagnosticHistory: owner.rpcQuery.diagnostics.stream.streamedOptions({
      maxChunks: 64,
      refetchMode: 'reset',
    }),
  }
})
```

`makeUserEventConsumer` rejects an inactive owner or a second consumer for the same QueryClient.
Scope closure unregisters Reactivity handlers and the mutation-cache listener. Close the event
Scope, retire the captured owner, and await its disposal before replacing clients; remount the
React consumers as described in [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/).

A closed or retired consumer ignores queued delivery and invalidation callbacks. It retains its
original QueryClient and cannot redirect an old event to a replacement client. A refresh already
started belongs to the native query lifecycle; owner retirement cancels those reads and awaits
local cleanup before releasing ready clients.

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

The `ownerKey` contains safe tenant, user, session, and permission-generation identity. It is a
routing partition, not authentication. The application must authenticate the transport and
validate which owner may receive each event.

## Coalesce local invalidation

Use the consumer's `reactivityKeys.directory`, `reactivityKeys.all`, or
`reactivityKeys.user({ id, locale })` with Effect Reactivity. Exact local user mappings exist for
the `observedUsers` registered when the consumer starts; include every detail read your local
writers must refresh. Delivered domain events can target any valid user.

These keys are stable application strings. Reactivity hashes its own keys; a TanStack query tuple
has no implied Reactivity subscription or prefix relationship. Register the deliberate mapping
rather than passing generated tuples to both systems.

Reactivity `withBatch` combines repeated invalidations of the same key. Distinct keys can still
invoke distinct handlers. The consumer collects their intent in one microtask and lets a full
user-branch refresh subsume narrower work. It merges more than 64 pending detail identities into
a full refresh, bounding delivery bookkeeping. Events received during a refresh form the next
batch.

Refreshes wait while the captured QueryClient has pending mutations, so an event does not start a
read over an optimistic write. The scoped mutation listener schedules retained intent when those
writes settle. Use the same QueryClient for these writes and follow
[Optimistic User Writes](/effect-api-query/guides/optimistic-writes/). Coordinate external writes
and other manual refresh paths through your own application policy.

`flush()` awaits currently runnable batches. During a pending mutation it leaves intent queued
until settlement. `onRefreshError` receives failures from the refresh job; ordinary native query
failures retain TanStack's query/error state and retry policy. The default refresh-job handler
reports the error to the console.

## Resume delivery deliberately

This recipe assumes one ordered, monotonically increasing cursor sequence per owner. It ignores
cursors already accepted. A gap queues a full user-branch refresh and advances the accepted cursor.
The cursor records accepted invalidation intent; it is not a durable acknowledgement or a claim
that a read succeeded.

Reconnect using `consumer.cursor()` as the last accepted cursor. Call `consumer.resume(true)` when
the transport can replay subsequent events in order. Replayed duplicates remain harmless. If
replay is unavailable, call `consumer.resume(false)` before accepting the new sequence: it resets
the cursor and refreshes both user branches. Stop delivery from the old connection first.

The application owns reconnect backoff, replay retention, cursor storage, source epochs, schema
migration, authorization, acknowledgements, and out-of-order delivery handling. A new owner Scope
starts at cursor zero. Fetch its authoritative reads on startup; this recipe does not promise
durable or exactly-once delivery. Invalid envelopes fail Schema decoding before changing the cursor.

## Choose a visible stream view

The example's diagnostic stream emits complete diagnostic values. `latestDiagnostic` uses a live
query; `diagnosticHistory` keeps at most 64 values with reset refetch behavior. Use the same choices
for an indefinitely running state stream: live queries require complete snapshots, while a bounded
accumulated query can display a recent event history.

An accumulated query with `refetchMode: 'replace'` publishes its replacement only when the refetch
stream completes. An indefinite stream may never publish that replacement. Use a live full
snapshot or a bounded history with a visibility policy suited to the UI. A live query containing
only the latest delta does not reconstruct domain state.

Native `Stream.runForEach` runs the supplied stream, and generated keys serve native Query filters.
Keep delivery, replay, and owner policy in the application consumer so its runtime and Scope remain
explicit.

---
title: Optimistic User Writes
description: Seed typed entries, roll back individual writes, and reconcile overlapping mutations.
---

Use generated concrete keys to update the reads affected by a mutation. Keep the write workflow
in the application, where the relationship between a domain operation and its reads is known.

The Vite React example applies this workflow to its existing user forms and directory. Copy
[the user-write module](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/user-writes.ts)
and compose it with your application's ready clients and QueryClient, as in
[the application](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts).
Its RPC and HTTP forms use the same application workflow and maintain distinct cache entries.

## Seed the mutation response

After creating a user, the example replaces that mutation's temporary entry in each cached
list with the returned `User`. It also seeds these concrete detail keys:

- `rpcQuery.users.get.queryKey({ id: user.id, locale: user.locale })`
- `httpQuery.users.get.queryKey({ params: { id: user.id }, query: { locale: user.locale } })`

The locale is part of the read input. A response with locale `fr` does not satisfy a detail query
whose constructor supplies the default locale `en`.

Use the generated DataTag keys directly with `getQueryData` and `setQueryData`. QueryClient owns
the hash function, including global and prefix defaults; the generated keys also serve native
cancellation and invalidation. Do not hash the keys independently.

## Apply and reconcile an optimistic write

The example's mutation options perform these actions:

1. Capture the original owner and reserve the write before awaiting anything.
2. Cancel the related RPC and HTTP reads through their generated user branch prefixes.
3. Snapshot the affected list and infinite entries. For deletion, keep the removed entity and its
   positions. For creation, allocate a temporary negative ID that belongs to this write.
4. Publish the optimistic change. Pending users cannot be deleted through the forms.
5. Replace a created user's temporary ID with the response, or roll back the failed write.
6. Invalidate both user branches when the final overlapping write settles.

Mutation responses remain ordinary Effect success values. An optimistic rollback restores the
application's cache; it cannot undo work the server has accepted.

## Preserve infinite pages

The example updates its existing four-user page views through their generated infinite keys.
It retains every page, `pageParams`, and unrelated user. A failed deletion restores only the
removed user at its former page position, preserving users created in the meantime.

Creation adjusts the total count on cached pages. It appends the new user to the last loaded page
only when that page has no next cursor. A partial directory waits for reconciliation to determine
where the user belongs. Each reconstructed page retains the `UserPage` representation.

Offset pagination can change after deletion or insertion. Preserving the current page structure
keeps the optimistic view usable until settlement invalidation refreshes the server's page
boundaries and cursors. Add concrete keys for any other page sizes or filters your application
uses; this example registers only its existing page size and initial cursor.

## Keep overlapping writes safe

A full snapshot rollback can erase a later successful write. The example instead removes a
failed creation's own temporary user, or restores one deleted user without replacing the list.
Overlapping deletions of the same user share the first snapshot: one successful deletion prevents
an older failure from restoring it, while all failed deletions restore the original entity once.

Each new write cancels an earlier reconciliation fetch before publishing its optimistic change.
Only the final pending write triggers settlement refetches, so an older settlement does not
refresh over a newer optimistic result. Success callbacks also cancel reads before seeding the
returned value. Native cancellation prevents a cancelled query from publishing a late result.

All writes to these views must participate in the same application workflow. Background domain
refreshes, manual cache replacement, and server-side write conflicts need their own coordination.
The example does not infer server ordering or define a general conflict-resolution policy.

## Retain the original owner

The `onMutate` result carries the original owner's commit, rollback, and settlement actions.
Callbacks invoke those actions and check that owner is active. A late response can neither refill
a cleared retired cache nor seed or invalidate a replacement client's entries.

Native MutationObserver option updates can replace callbacks on a pending mutation. Carrying the
transaction in `onMutate` prevents a later callback closure from redirecting an already-started
write. Remount mutation consumers when replacing an application owner: an options change while
`onMutate` awaits cancellation can otherwise replace the mutation function before it starts.

Track mutation-function completion before releasing the application's ready clients. These
writes use `networkMode: 'always'` and `retry: false`, so a retired owner does not retain paused
mutation work. They do not use a native mutation scope queue. Mutations have no query abort signal;
retirement and cache clearing do not cancel an accepted server write.

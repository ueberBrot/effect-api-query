---
title: Optimistic User Writes
description: Seed typed entries, roll back individual writes, and reconcile overlapping mutations.
---

An optimistic update changes cached data before the server replies. Use the generated keys to target the reads that a write affects.

The Vite React example uses the same workflow for RPC and HTTP while keeping their cache entries distinct. See the [write module](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/user-writes.ts) and [application setup](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts).

## Seed the mutation response

When the server returns the new user, replace that write's temporary list entry. Also seed the exact detail keys for the returned user.

- `rpcQuery.users.get.queryKey({ input: { id: user.id, locale: user.locale } })`
- `httpQuery.users.get.queryKey({ input: { params: { id: user.id }, query: { locale: user.locale } } })`

A French response belongs under a French detail key. An RPC detail query that uses the default English locale has a different key.

Pass generated keys to `getQueryData` and `setQueryData` to keep the types. Let QueryClient hash them with its configured defaults.

## Apply and reconcile an optimistic write

The example uses these steps for each write.

1. Record the current cache owner and reserve the write before awaiting anything.
2. Cancel RPC and HTTP reads under their user prefixes.
3. Save affected list and infinite entries. For deletion, record the user and its positions. For creation, assign a temporary negative ID.
4. Publish the change locally. The forms block deletion of pending users.
5. Replace the temporary ID on success or roll back the failed write.
6. Invalidate both user branches after the last overlapping write settles.

Mutations return the original Effect success value. A rollback restores cached data. To reverse completed server work, use a separate server operation.

## Preserve infinite pages

Update each affected page through its infinite key. Preserve `pageParams`, other users, and every page. If deletion fails, restore the user at its former position and keep users created in the meantime.

Update the total count when you add a user. Append the user to the final loaded page only if it has no next cursor. Otherwise wait for the server to place it. Preserve the `UserPage` shape.

Inserting or deleting a user can change offsets. Invalidate after settlement so the server can update page boundaries and cursors. The example covers one page size and initial cursor. Add exact keys for any other filters or sizes you use.

## Keep overlapping writes safe

Roll back only the failed change. Remove its temporary user or restore its deleted user beside surviving original neighbors. This keeps later successful writes and preserves the relative order of overlapping deletions.

If a newer authoritative update replaces the optimistic revision, keep that update even if the data matches. Deletions after a refresh save the new position. Overlapping deletions of one user share their first snapshot. Restore the user once if every attempt fails. If any attempt succeeds, an older failure cannot restore it.

Cancel a previous reconciliation fetch before publishing a new write. Cancel reads again before seeding a response. TanStack prevents cancelled queries from publishing late results. Wait for the last pending write before triggering another refetch.

Route writes to these views through the same workflow. Coordinate background refreshes, manual cache replacement, and server-side conflicts in your app.

## Retain the original owner

Return the original owner's commit, rollback, and settlement actions from `onMutate`. Check that the owner is active before applying them. This keeps late responses out of retired and replacement caches.

A native MutationObserver can replace callbacks while a mutation is pending. Carry the original transaction in `onMutate`. Remount mutation consumers when you replace the owner. If options change while `onMutate` awaits cancellation, the observer can replace the mutation function before it starts.

Wait for accepted mutation functions before releasing their clients. The example uses `networkMode: 'always'` and `retry: false` to avoid paused work. It leaves native mutation scope queues unused. An accepted server write can continue after cache retirement.

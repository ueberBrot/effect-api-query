---
title: Conditional Queries
description: Pause queries until their required input is available.
---

Pause a query while the user has no selection. Import your framework's `useQuery` hook. This example uses the utilities from the [RPC quick start](/effect-api-query/getting-started/quick-start/), named `rpcQuery` here.

If `userId` is undefined, pass `input: skipToken`. Keep options such as `staleTime`, `select`, or `initialData` on the same builder call.

```ts
import { skipToken } from "@ueberbrot/effect-api-query";

type User = { id: number; name: string };

const displayOptions = { staleTime: 30_000, select: (user: User) => user.name };

const userOptions = rpcQuery.users.get.queryOptions({
  ...displayOptions,
  input: userId === undefined ? skipToken : { id: userId },
});

const user = useQuery(userOptions);
```

For an HTTP endpoint with only a numeric ID in its path, pass a decoded `params` object when the ID is available.

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: userId === undefined ? skipToken : { params: { id: userId } },
  staleTime: 30_000,
  select: (user) => user.name,
});
```

`skipToken` is the value exported by Query Core. The skipped key ends at the operation prefix. The builder leaves the caller's options and selected types intact and removes `input` before TanStack receives them. A skipped HTTP query never encodes or sends the request.

TanStack still uses supplied `initialData`. React Query's `useQuery` types skipped data as possibly `undefined` because its defined-data overload excludes `skipToken`. With defined initial data or a factory that returns it, `useInfiniteQuery` retains its defined-data overload even for conditional input.

Pass `skipToken` to input-bearing query, infinite, streamed, live, and HTTP metadata option builders. Leave inputless operations without input. Key builders, mutations, and TanStack's Suspense and prefetch-only hooks reject the sentinel.

Keep both branches of the condition inside one builder call so callbacks share a type. Literal inputs and a literal `skipToken` retain precise key and function types. A conditional input keeps both possibilities.

For an RPC such as `events.watch` that takes a string `channel` and emits strings, choose an accumulated or live view in the same way.

```ts
rpcQuery.events.watch.streamedOptions({
  maxChunks: 100,
  input: channel === undefined ? skipToken : { channel },
  refetchMode: "append",
  staleTime: 30_000,
});
rpcQuery.events.watch.liveOptions({
  input: channel === undefined ? skipToken : { channel },
  select: (value) => value.length,
});
```

Skipped streams still validate retention, refetch mode, and HTTP SSE decoder options. The builder removes `refetchMode` from the options it returns. For infinite queries, pass the page mapper or sentinel in `input`. Supply `initialPageParam` and `getNextPageParam` in both cases.

Supply valid input before calling `refetch()` because a skipped query has no query function. If the request is complete and you want to run it manually, use `enabled: false`.

For HTTP pagination, build the full request for each page. See [pagination](/effect-api-query/guides/pagination/) for stable filters and cursors.

In the [example apps](/effect-api-query/examples/#pause-a-query-until-a-user-is-selected), use **Choose before fetching**. Clear and reselect a user while the cached result is fresh to see it reused.

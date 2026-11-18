---
title: Defaults and Policies
description: Configure shared defaults and execution behavior across a utility tree.
---

Use `configureUtils` to share settings and interceptors across a tree, branch, or leaf. Configure the utilities once per cache owner, then pass their options to TanStack Query.

For immutable decoded dates, collections, or Schema classes, see [share decoded values](/effect-api-query/guides/share-decoded-values/).

| Scope | Use | Suitable settings |
| --- | --- | --- |
| Cache owner or namespace | QueryClient defaults and generated prefixes | Common freshness, retry, garbage collection, and hashing |
| Tree, branch, or leaf | `configureUtils` | Shared policies, ordered execution interceptors, and stream retention |
| One call | The options builder | Input, selection, initial data, pagination, optimistic context, and local overrides |

## Register native defaults

Import `QueryClient` from `@tanstack/query-core` and `viewPrefix` from `@ueberbrot/effect-api-query`.

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 600_000,
      retry: false,
      retryDelay: 250,
    },
    mutations: { retry: false },
  },
});
```

After you build `rpc`, register broad prefixes before narrow ones.

```ts
queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 });
queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 });
queryClient.setQueryDefaults(viewPrefix(rpc.users.get, "query"), {
  staleTime: 120_000,
});
```

TanStack merges defaults in registration order. Here `users.get` gets `gcTime: 600_000`, `retry: 2`, and `staleTime: 120_000`. Two retries allow three executions.

`rpc.key()` targets the whole tree. `rpc.users.key()` targets one branch. A view prefix targets one view of one leaf across all inputs. HTTP uses the same methods.

```ts
queryClient.setQueryDefaults(http.users.key(), { retry: 1 });
queryClient.setQueryDefaults(viewPrefix(http.users.get, "metadata"), {
  staleTime: 5000,
});
```

Set mutation defaults with `setMutationDefaults` and `mutationKey()`. Configure hashing before using the cache and keep it stable for that cache. See [cache keys and filters](/effect-api-query/guides/cache-filters/) for prefix scope.

## Configure a leaf

Import `configureUtils` and `QueryPolicy` from `@ueberbrot/effect-api-query`. Policy callbacks on a leaf infer its cached data and execution errors.

```ts
const policy = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} satisfies QueryPolicy<typeof rpc.users.get>;
const user = configureUtils(rpc.users.get, { query: { policy } });
const selected = user.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
});
const refreshUser = user.queryOptions({
  input: { id: 1 },
  staleTime: 0,
  retry: false,
});
```

The configured leaf keeps its builders and keys. Use `QueryPolicy<Leaf, View>` to type a reusable policy. Specify `"infinite"`, `"metadata"`, `"live"`, or `"streamed"` for those views.

Set input, `select`, initial or placeholder data, page parameters, mappers, and request controls at the call site. Set retention there or under `streamed.policy`.

## Configure a tree or branch

Set a view policy on a tree or branch to apply it to supported descendants. Use `scoped` for specific children.

```ts
const configured = configureUtils(rpc, {
  query: { policy: { retry: false } },
  scoped: {
    users: {
      query: { policy: { staleTime: 30_000 } },
      scoped: {
        get: {
          query: {
            policy: {
              staleTime: (query) =>
                query.state.data === undefined ? 0 : 60_000,
            },
          },
        },
      },
    },
  },
});
```

The `get` callback infers that leaf's types. Shared callbacks on a tree or branch use `unknown` for data, errors, and variables because their descendants can differ.

Defaults apply from broad to specific. QueryClient defaults come first, followed by tree, branch, leaf, and call-site options. Omit a field to inherit it. Where a field accepts `undefined`, pass it explicitly to clear the inherited value. Native prefix defaults merge in registration order.

`configureUtils` returns a frozen copy with the same keys. Prepared inputs and consumers of the original leaf still work with the configured copy.

Repeated calls keep scope order. Within one scope, later policies replace earlier values. Earlier interceptors remain outermost.

Within one mutation scope, later callbacks replace earlier ones. The latest supplied callback mode governs the resulting policy.

Use `satisfies UtilsConfiguration<typeof rpc>` for a reusable configuration. This keeps literal settings, such as required stream retention, visible to the configured builders.

## Share mutation behavior

Set `mutation.policy` to cache the returned user and invalidate affected reads.

```ts
const createUser = configureUtils(rpc.users.create, {
  mutation: {
    policy: {
      onSuccess: async (created) => {
        queryClient.setQueryData(
          rpc.users.get.queryKey({ id: created.id }),
          created
        );
        await queryClient.invalidateQueries({ queryKey: rpc.users.key() });
      },
    },
  },
});
```

Leaf callbacks infer data, variables, and errors. Define `onMutate` at the call site so local callbacks infer its result. Shared policy callbacks see that result as `unknown`.

```ts
const creation = createUser.mutationOptions({
  onMutate: (variables) => ({ submittedName: variables.name }),
  onError: (error, _variables, context) => {
    reportCreationFailure(context?.submittedName, error);
  },
});
```

A more specific callback replaces its matching shared callback by default. To await both, choose composition.

```ts
const composedCreateUser = configureUtils(rpc.users.create, {
  mutation: {
    callbacks: "compose",
    policy: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
    },
  },
});
```

Composition runs shared `onSuccess`, `onError`, and `onSettled` callbacks before more specific ones. If the first callback rejects, TanStack handles the error and the second callback in that pair does not run. Each scope sets the mode for its own callbacks.

A scope's composed callbacks remain active if a narrower scope uses replacement.

JavaScript callers can clear a composed callback by explicitly setting it to `undefined`.

## Intercept execution

Use an interceptor to wrap each execution. This mutation calls the app's `authorizeCreation` function first.

```ts
const interceptedCreateUser = configureUtils(rpc.users.create, {
  mutation: {
    interceptors: [
      async ({ input, next }) => {
        await authorizeCreation(input);
        return await next();
      },
    ],
  },
});
```

Query interceptors get `next` and native query context. Mutation interceptors also get input. A direct mutation function call without a native observer has undefined context. For an infinite query, `next` returns one page.

Interceptors wrap every attempt, including retries, from tree to branch to leaf. The first entry runs outermost. Call `next` at most once and preserve the query's abort signal. Local callbacks cannot replace interceptors. Skipped queries remain disabled.

See the [compiled recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-policies.ts) for imports and contracts, or [retry queries](/effect-api-query/guides/retry-queries/) for a shared retry decision.

## Assemble policies in the application

Use `defineUtilsPolicy<Node>()` to type a policy map before acquiring a client. Derive `Node` from `RpcQueryUtils<Group, Prefix, ClientError>` or `HttpApiQueryUtils<Api, Prefix, Client>`. Include the real client error type. To configure just one branch or leaf, use that node's type.

Keep the Effect declaration in the shared contract package. Define callbacks, the cache, and the runtime in the app. `defineUtilsPolicy` returns the supplied map with its literal types. Pass it to `configureUtils` to copy settings and interceptors onto the utilities. Keep retained values and callback dependencies unchanged.

This example uses `exampleRpcGroup` to define reusable defaults before it has a client. The app supplies its provider's QueryClient and a notification callback.

```ts
import { exampleRpcGroup } from "@effect-api-query/contracts";
import type { QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createRpcQueryUtils,
  defineUtilsPolicy,
} from "@ueberbrot/effect-api-query";
import type { RpcQueryUtils } from "@ueberbrot/effect-api-query";
import type { RpcClient, RpcGroup } from "effect/rpc";

type ApplicationUtils = RpcQueryUtils<
  typeof exampleRpcGroup,
  readonly ["policy-app"]
>;

export const applicationPolicy = defineUtilsPolicy<ApplicationUtils>()({
  query: { policy: { retry: false } },
  scoped: {
    users: {
      query: { policy: { staleTime: 30_000 } },
      scoped: {
        get: { query: { policy: { staleTime: 60_000 } } },
      },
    },
  },
});

export const applicationQueries = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof exampleRpcGroup>>,
  queryClient: QueryClient,
  notifyCreated: (name: string, requestedName: string) => void
) => {
  const base = createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix: ["policy-app"],
  });
  const writes = defineUtilsPolicy<ApplicationUtils["users"]["create"]>()({
    mutation: {
      callbacks: "compose",
      policy: {
        onSuccess: async (user) => {
          queryClient.setQueryData(
            base.users.get.queryKey({ id: user.id, locale: user.locale }),
            user
          );
          await queryClient.invalidateQueries({
            queryKey: base.users.list.key(),
          });
        },
      },
    },
  });
  const configured = configureUtils(base, applicationPolicy);
  const create = configureUtils(configured.users.create, writes);
  return {
    rpc: configured,
    selectedUser: (id: number) =>
      configured.users.get.queryOptions({
        input: { id },
        staleTime: 5000,
        select: (user) => user.name,
      }),
    pages: configured.users.page.infiniteOptions({
      initialPageParam: 0,
      input: (cursor) => ({ cursor, pageSize: 10 }),
      getNextPageParam: (page) => page.nextCursor,
    }),
    createUser: create.mutationOptions({
      onMutate: (input) => ({ requestedName: input.name }),
      onSuccess: (user, _input, optimistic) => {
        notifyCreated(user.name, optimistic.requestedName);
      },
    }),
  };
};
```

Call `applicationQueries` once per owner. Pass `selectedUser(id)`, `pages`, and `createUser` to their native hooks. Rebuild options when input changes. The shared mutation callback seeds the exact read and marks the list stale before the local notification. The call site keeps its typed `onMutate` result.

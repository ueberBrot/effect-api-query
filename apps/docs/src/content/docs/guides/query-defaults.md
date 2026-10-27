---
title: Defaults and Policies
description: Configure shared defaults and execution behavior across a utility tree.
---

Use `configureUtils` to share policies and interceptors across a utility tree, branch, or leaf. Build the configured utilities once per cache owner, then pass their generated options to native TanStack Query consumers.

| Scope | Use | Suitable settings |
| --- | --- | --- |
| Cache owner or namespace | QueryClient defaults and generated prefixes | Common freshness, retry, garbage collection, and hashing |
| Tree, branch, or leaf | `configureUtils` | Shared policies, ordered execution interceptors, and stream retention |
| One call | The options builder | Input, selection, initial data, pagination, optimistic context, and local overrides |

## Register native defaults

In the cache module, import `QueryClient` from `@tanstack/query-core` and `viewPrefix` from `@ueberbrot/effect-api-query`:

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

After creating `rpc` with its ready client, register broader prefixes before narrower prefixes:

```ts
queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 });
queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 });
queryClient.setQueryDefaults(viewPrefix(rpc.users.get, "query"), {
  staleTime: 120_000,
});
```

TanStack merges matching prefixes in registration order. Here, `users.get` inherits `gcTime: 600_000`, `retry: 2`, and `staleTime: 120_000`. Two retries allow at most three executions.

`rpc.key()` covers the tree, `rpc.users.key()` covers its branch, and the view prefix covers only ordinary queries of that leaf, for every input. HTTP uses the same native APIs:

```ts
queryClient.setQueryDefaults(http.users.key(), { retry: 1 });
queryClient.setQueryDefaults(viewPrefix(http.users.get, "metadata"), {
  staleTime: 5_000,
});
```

Register mutation defaults separately with native `setMutationDefaults` and `mutationKey()`. Configure hashing through QueryClient defaults before using the cache, and keep it stable for the cache owner's lifetime. See [Cache Keys and Filters](/effect-api-query/guides/cache-filters/) for prefix scopes.

## Configure a leaf

Import `configureUtils` and the type `QueryPolicy` from `@ueberbrot/effect-api-query`. A leaf policy receives its view's cached data and error types:

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

The configured leaf retains its supported query views, mutation builder, and key functions. `QueryPolicy<Leaf, View>` types a reusable native policy. Specify `"infinite"`, `"metadata"`, `"live"`, or `"streamed"` when the policy applies to that view.

Keep input, `select`, initial and placeholder data, page parameters and mappers, and adapter request controls at each call. Configure stream retention through `streamed.policy` or supply it locally.

## Configure a tree or branch

A tree or branch can supply view policies for every supported descendant leaf. Use `scoped` to configure specific children:

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

The `get` callback above receives that leaf's data and errors. Shared tree and branch policy callbacks receive `unknown` for data, errors, and mutation variables because descendants can have different contracts.

Settings apply from broad to specific: QueryClient defaults, configured tree defaults, branch defaults, leaf defaults, then call-site options. Omitted fields inherit. Options that accept `undefined` can use it to replace an inherited value. Native prefix defaults still merge in registration order.

`configureUtils` returns frozen configured utilities and leaves the supplied tree unchanged. Existing keys and prepared inputs continue to work with the configured copies.

Configured utilities also fit helpers and components typed for the original tree.

Repeated calls preserve scope order. At the same scope, later policies replace earlier values, and earlier interceptors remain outermost.

Within one mutation scope, later callbacks replace earlier callbacks. The latest supplied callback mode applies to the resulting policy.

For reusable configuration objects, use `satisfies UtilsConfiguration<typeof rpc>` instead of a type annotation. This preserves specific settings such as required stream retention, so configured builders can infer that the default is present.

## Share mutation behavior

Configure `mutation.policy` to seed the returned user and invalidate affected reads:

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

Leaf callbacks infer result data, variables, and execution errors. Keep `onMutate` at the call site so local callbacks infer its result. Shared policy callbacks receive that result as `unknown`:

```ts
const creation = createUser.mutationOptions({
  onMutate: (variables) => ({ submittedName: variables.name }),
  onError: (error, _variables, context) => {
    reportCreationFailure(context?.submittedName, error);
  },
});
```

By default, a more specific callback replaces the corresponding shared callback. To await shared and local callbacks, choose composition:

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

Composition runs shared callbacks before more specific callbacks for `onSuccess`, `onError`, and `onSettled`. A rejection stops that pair and follows native mutation error handling. Each scope chooses replacement or composition for the callbacks it adds.

A scope's composition setting keeps its own callbacks active when a narrower scope uses replacement.

JavaScript callers can clear a composed callback by explicitly setting it to `undefined`.

## Intercept execution

Use an interceptor when application behavior must run around execution. This example calls the application's `authorizeCreation` function before the mutation:

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

Query interceptors receive `next` and the native query context. Mutation interceptors also receive input; their context is undefined when the mutation function is called directly without a native observer. For infinite queries, `next` returns one page.

Interceptors run from tree to branch to leaf, with the first entry outermost. They wrap every native execution attempt, including retries, and each may call `next` at most once. Local lifecycle callbacks cannot replace them. Preserve the query abort signal in application work around `next`. Skipped queries stay disabled.

The [compiled recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-policies.ts) includes the contracts and imports used here. For typed retry decisions, see [Retry Queries](/effect-api-query/guides/retry-queries/).

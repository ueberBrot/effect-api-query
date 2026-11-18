---
title: Type Inference
description: Derive operation inputs, cached data, mutation results, and failures from generated leaves.
---

Import these types from `@ueberbrot/effect-api-query` to infer input, cache data, mutation results, or errors from a generated leaf.

| Type | Result |
| --- | --- |
| `InferInput<Leaf>` | The accepted operation input |
| `InferQueryData<Leaf, View>` | Cached data for a supported query view, before `select` |
| `InferQueryError<Leaf, View>` | Execution and package failures carried by that query view |
| `InferMutationData<Leaf>` | The successful buffered mutation result |
| `InferMutationError<Leaf>` | The buffered mutation's execution error |

Keep declaration identifiers literal so the utilities retain exact paths and supported views. Additional ready-client errors flow into the inferred types.

## Operation input

Use a leaf from the client module.

```ts
const input: InferInput<typeof rpc.users.get> = { id: 1 };
type UserData = InferQueryData<typeof rpc.users.get>;
type HistoryData = InferQueryData<typeof rpc.diagnostics.stream, "streamed">;
type UserError = InferQueryError<typeof rpc.users.get>;
```

For RPC, infer the payload constructor input, including optional defaults. For HTTP, infer the declared decoded request parts and `FormData` for multipart payloads. Inputless leaves use `void`. `skipToken` pauses a query without changing the leaf's input type.

## Query views and cached data

Query helpers default to `query`. For a streaming leaf, specify `live` or `streamed`. The leaf constrains `View` to its supported builders.

| Leaf                             | Query views                     |
| -------------------------------- | ------------------------------- |
| Unary RPC                        | `query`, `infinite`             |
| Buffered nonmultipart HTTP       | `query`, `infinite`, `metadata` |
| RPC stream or supported HTTP SSE | `streamed`, `live`              |
| Buffered multipart HTTP          | Mutation-only                   |

An unsupported explicit view fails typechecking. If a leaf has no ordinary query, the default resolves to `never`. Supply a supported view.

Buffered and live data convert a whole `undefined` to `null`. Accumulated history keeps each value. Infinite data has pages and page parameters. Metadata has decoded data, status, and headers. See [inputs and query data](/effect-api-query/concepts/data-normalization/).

`InferQueryData` describes the cache. Native `select` changes what the consumer receives.

```ts
const selectedOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
});
const selectedName = await queryClient.query(selectedOptions);
const cachedUser = queryClient.getQueryData(selectedOptions.queryKey);
```

`selectedName` is a string. `cachedUser` is the decoded user or `undefined`. Generated keys retain the full cache type, exact path, and view. The canonical payload slot is `unknown`. Use generated keys for exact access and projections for partial matching. Treat broad results as `unknown` until you establish their shape.

Standalone infinite keys and `InferQueryData<Leaf, 'infinite'>` use `unknown` for page parameters. `infiniteOptions(...)` retains the inferred parameter type.

## Mutation results

Infer data and errors separately for a write.

```ts
type CreateUserInput = InferInput<typeof rpc.users.create>;
type CreatedUser = InferMutationData<typeof rpc.users.create>;
type CreateUserError = InferMutationError<typeof rpc.users.create>;
```

A mutation retains its decoded success value, including `undefined`. Callbacks infer variables, data, errors, and the local `onMutate` result. See [defaults and policies](/effect-api-query/guides/query-defaults/) for shared callbacks.

## Failures at runtime

Inferred errors cover declared execution and adapter failures. A custom runner or callback can reject with another value. Generated execution errors retain the complete Effect Cause.

Identify the wrapper with a package guard, then narrow the domain failure before reading its fields. See [handle failures](/effect-api-query/guides/handle-failures/) and the [error reference](/effect-api-query/reference/errors/).

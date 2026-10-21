---
title: Type Inference
description: Derive operation inputs, cached data, mutation results, and failures from generated leaves.
---

These types are exported from `@ueberbrot/effect-api-query`. Each describes a generated leaf's contract:

| Type | Result |
| --- | --- |
| `InferInput<Leaf>` | The accepted operation input |
| `InferQueryData<Leaf, View>` | Cached data for a supported query view, before `select` |
| `InferQueryError<Leaf, View>` | Execution and package failures carried by that query view |
| `InferMutationData<Leaf>` | The successful buffered mutation result |
| `InferMutationError<Leaf>` | The buffered mutation's execution error |

The helpers follow the utility tree's contract and ready-client types. Literal declaration names preserve leaf paths and supported views.

## Operation input

The utility tree from a client module supplies the leaf types:

```ts
const input: InferInput<typeof rpc.users.get> = { id: 1 };
type UserData = InferQueryData<typeof rpc.users.get>;
type HistoryData = InferQueryData<typeof rpc.diagnostics.stream, "streamed">;
type UserError = InferQueryError<typeof rpc.users.get>;
```

RPC input is payload constructor input. Fields supplied by constructor defaults can be omitted. HTTP input is the decoded request with its declared `params`, `query`, `headers`, and `payload` containers. Multipart HTTP requests use `FormData` in the payload container. Inputless leaves use `void`. A call to an options builder can use `skipToken` to disable execution without changing the leaf's operation input contract.

## Query views and cached data

Query data and error helpers default to `query`. Streaming leaves require an explicit `live` or `streamed` view. A leaf constrains `View` to the views with supported key and option builders:

| Leaf                             | Query views                     |
| -------------------------------- | ------------------------------- |
| Unary RPC                        | `query`, `infinite`             |
| Buffered nonmultipart HTTP       | `query`, `infinite`, `metadata` |
| RPC stream or supported HTTP SSE | `streamed`, `live`              |
| Buffered multipart HTTP          | Mutation-only                   |

An unsupported explicit view fails typechecking. If a leaf has no ordinary query, omitting the view produces `never`. That leaf requires a supported explicit view.

Buffered and live query data normalize top-level successful `undefined` to `null`. Accumulated histories preserve each emitted value. Infinite data includes pages and page parameters. Metadata contains decoded data, status, and headers. See [Data Normalization](/effect-api-query/concepts/data-normalization/) for ownership rules.

`InferQueryData` describes cache contents. A native `select` changes the returned value:

```ts
const selectedOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
});
const selectedName = await queryClient.query(selectedOptions);
const cachedUser = queryClient.getQueryData(selectedOptions.queryKey);
```

In this example, `selectedName` is a string, and `cachedUser` is the decoded user or `undefined`. The generated key retains the unselected cache type. Broad prefix or filter reads can contain different views. Their results remain `unknown` until the application establishes their representation.

Standalone infinite keys use `unknown` for page parameters, as does `InferQueryData<Leaf, 'infinite'>`. An `infiniteOptions(...)` result retains the page parameter inferred from that call.

## Mutation results

The write contract has separate data and error types:

```ts
type CreateUserInput = InferInput<typeof rpc.users.create>;
type CreatedUser = InferMutationData<typeof rpc.users.create>;
type CreateUserError = InferMutationError<typeof rpc.users.create>;
```

Mutation data preserves the successful decoded value, including `undefined`. The options builder infers variables, data, errors, and the local `onMutate` result for mutation callbacks. [Defaults and Policies](/effect-api-query/guides/query-defaults/) describes how reusable typed callbacks preserve local inference.

## Failures at runtime

Inferred errors describe declared execution and package failures. Execution errors retain the full Effect `Cause`. A custom runner rejection or an error from an application callback can pass through unchanged. The inferred union does not validate those unknown failures.

The package's execution-error guards narrow execution errors. Domain failures need further narrowing before their fields can be read. See [Handle Failures](/effect-api-query/guides/handle-failures/) and the [error reference](/effect-api-query/reference/errors/).

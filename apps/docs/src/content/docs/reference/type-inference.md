---
title: Type Inference
description: Derive operation inputs, cached data, mutation results, and failures from generated leaves.
---

Import these types from `effect-api-query` and apply them to a generated leaf:

| Type                          | Result                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `InferInput<Leaf>`            | The accepted operation input                              |
| `InferQueryData<Leaf, View>`  | Cached data for a supported query view, before `select`   |
| `InferQueryError<Leaf, View>` | Execution and package failures carried by that query view |
| `InferMutationData<Leaf>`     | The successful buffered mutation result                   |
| `InferMutationError<Leaf>`    | The buffered mutation's execution error                   |

These helpers follow the utility tree's contract and ready-client types. Keep those declaration
names literal to preserve leaf paths and supported views.

## Operation input

With the utility tree from your client module:

```ts
const input: InferInput<typeof rpc.users.get> = { id: 1 }
type UserData = InferQueryData<typeof rpc.users.get>
type HistoryData = InferQueryData<typeof rpc.diagnostics.stream, 'streamed'>
type UserError = InferQueryError<typeof rpc.users.get>
```

RPC input is **payload constructor input**, so fields supplied by constructor defaults may be
omitted. HTTP input is the **decoded request** with its declared `params`, `query`, `headers`, and
`payload` containers. Multipart HTTP requests use `FormData` in the payload container. Inputless
leaves use `void`. `skipToken` disables an options-builder call; it does not change the leaf's
operation input contract.

## Query views and cached data

Query data and error helpers default to `query`. A streaming leaf needs an explicit `live` or
`streamed` view. Each leaf constrains `View` to its supported key and option builders:

| Leaf                             | Query views                     |
| -------------------------------- | ------------------------------- |
| Unary RPC                        | `query`, `infinite`             |
| Buffered nonmultipart HTTP       | `query`, `infinite`, `metadata` |
| RPC stream or supported HTTP SSE | `streamed`, `live`              |
| Buffered multipart HTTP          | Mutation-only                   |

An unsupported explicit view fails typechecking. Omitting the view on a leaf with no ordinary
query produces `never`; specify its supported view.

Buffered and live query data normalize top-level successful `undefined` to `null`. Accumulated
histories preserve each emitted value. Infinite data includes pages and page parameters; metadata
contains decoded data, status, and headers. See
[Data Normalization](/effect-api-query/concepts/data-normalization/) for ownership rules.

`InferQueryData` describes cache contents. A native `select` changes the returned value:

```ts
const selectedOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
})
const selectedName = await queryClient.query(selectedOptions)
const cachedUser = queryClient.getQueryData(selectedOptions.queryKey)
```

Here `selectedName` is a string and `cachedUser` is the decoded user or `undefined`. The generated
key retains the unselected cache type. Broad prefix/filter reads can contain different views;
keep those results `unknown` until the application establishes their representation.

Standalone infinite keys, and therefore `InferQueryData<Leaf, 'infinite'>`, use `unknown` for page
parameters. An `infiniteOptions(...)` result retains the page parameter inferred from that call.

## Mutation results

Infer the write contract separately:

```ts
type CreateUserInput = InferInput<typeof rpc.users.create>
type CreatedUser = InferMutationData<typeof rpc.users.create>
type CreateUserError = InferMutationError<typeof rpc.users.create>
```

Mutation data preserves the successful decoded value, including `undefined`. Mutation callbacks
infer variables, data, errors, and their local `onMutate` result through the options builder.
Use [Defaults and Policies](/effect-api-query/guides/query-defaults/) to reuse typed callbacks while
preserving that local inference.

## Failures at runtime

Inferred errors describe declared execution and package failures. Execution errors retain the full
Effect `Cause`. A custom runner rejection or an error thrown by an application callback can pass
through unchanged; the inferred union does not validate those unknown failures.

Use the package's execution-error guards and refine domain failures before reading their fields.
See [Handle Failures](/effect-api-query/guides/handle-failures/) and the
[error reference](/effect-api-query/reference/errors/).

---
title: Retry Queries
description: Reuse bounded read policies with typed Effect failures and native Query options.
---

Bind a retry policy with `withQueryPolicy`. Use the returned options builder wherever you need
that read. Each call keeps native `select`, input, and initial-data inference. Call-site options
replace matching defaults.

The policy below permits two retries after the initial failure, for at most three executions.
It allows a declared `RetryLater` or an application-approved transport failure.
Use it for idempotent reads whose transport does not already own retries.

## Share the decision and delay

Import `Cause`, `Result`, and `Schema` from `effect`. Define `RetryLater` with a finite
`retryAfterMs` field in your contract, then reuse this application helper for RPC and HTTP:

```ts
const retryPolicy = <Error, Failure>(
  causeOf: (error: Error) => Cause.Cause<Failure> | undefined,
  isTransient: (failure: Failure) => boolean,
) => ({
  retry: (failureCount: number, error: Error) => {
    const cause = causeOf(error)
    if (
      !cause ||
      failureCount >= 2 ||
      Cause.hasDies(cause) ||
      Cause.hasInterrupts(cause) ||
      cause.reasons.length !== 1
    ) {
      return false
    }
    const failure = Cause.findError(cause)
    return (
      Result.isSuccess(failure) &&
      (Schema.is(RetryLater)(failure.success) || isTransient(failure.success))
    )
  },
  retryDelay: (attemptIndex: number, error: Error) => {
    const cause = causeOf(error)
    if (cause) {
      const failure = Cause.findError(cause)
      if (Result.isSuccess(failure) && Schema.is(RetryLater)(failure.success)) {
        return Math.min(30_000, Math.max(0, failure.success.retryAfterMs))
      }
    }
    return Math.min(1_000 * 2 ** attemptIndex, 30_000)
  },
})
```

The helper rejects defects, interruptions, and Causes with multiple reasons. `Cause.findError`
returns a `Result`. The successful value retains the typed failure union. Schema refinement also handles
unknown values safely. The adapter guard rejects custom runner failures that pass through unchanged.

## Bind a typed RPC policy

Import `withQueryPolicy`, `isEffectRpcQueryError`, and the type `InferQueryError` from
`@ueberbrot/effect-api-query`, plus `RpcClientError` from `effect/rpc`. After acquiring your ready client and
creating `rpc`, bind the profile read:

```ts
type Error = InferQueryError<typeof rpc.profile.read>
const read = withQueryPolicy(
  rpc.profile.read,
  'query',
  retryPolicy(
    (error: Error) => (isEffectRpcQueryError(error) ? error.cause : undefined),
    (failure) =>
      Schema.is(RpcClientError.RpcClientError)(failure) &&
      failure.reason._tag === 'HttpError' &&
      failure.reason.kind === 'TransportError',
  ),
)
return read()
```

This application allows only RPC's HTTP transport failures. Socket and worker reconnect policy
belongs to the application that owns those transports.

## Bind the same decision to HTTP

Import `isEffectHttpApiQueryError` from `@ueberbrot/effect-api-query` and `HttpClientError` from `effect/http`.
Reuse the shared retry logic with HTTP's transport classifier:

```ts
type Error = InferQueryError<typeof http.profile.read>
const read = withQueryPolicy(
  http.profile.read,
  'query',
  retryPolicy(
    (error: Error) => (isEffectHttpApiQueryError(error) ? error.cause : undefined),
    (failure) =>
      HttpClientError.isHttpClientError(failure) && failure.reason._tag === 'TransportError',
  ),
)
return read()
```

Encoding, decoding, response, `NotFound`, and authentication failures receive no retry. Restore an
expired session before invalidating its affected queries.

The [complete compiled recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-retry.ts)
contains the contracts and both ready-client factories. See [Query Defaults](/effect-api-query/guides/query-defaults/)
for policy types, mutation callbacks, and precedence.

## Set defaults deliberately

| Execution                                                      | Native retry default without application overrides |
| -------------------------------------------------------------- | -------------------------------------------------- |
| Browser query observer, such as `useQuery`                     | Three retries after the initial attempt            |
| Server query observer                                          | Zero retries                                       |
| Imperative `queryClient.query` and `queryClient.infiniteQuery` | Retries disabled                                   |
| Mutation                                                       | Retries disabled                                   |

QueryClient global and prefix defaults still apply. Set `retry` explicitly when attempt counts
matter. `retry: 2` permits three executions. `retry: false` permits one.

Choose one layer to own retries. Two retries in TanStack combined with two retries per invocation
in Effect can make nine client attempts. A retry around iterable creation does not retry later
stream consumption. Restart a stream only when restarting is safe for that operation. Retention and refetch
policies still govern cache publication. Mutation retries require application idempotency.

`retryDelay` receives a zero-based attempt index and returns milliseconds. Query Core can evaluate
it for terminal failures, so keep it pure. This recipe clamps server delays and exponential backoff
to 30 seconds.

## Handle preparation before execution

Factory, builder, and key-generation errors are synchronous. If input or custom encoders can fail,
prepare options inside `try`. Pass successfully prepared options to Query Core. Preparation failures
never enter execution retry. An infinite page-input mapper runs later. Its thrown errors pass
through unchanged. Mutation encoding occurs inside the ready client's Effect and uses its Cause.

Keep QueryClient hashing stable while entries remain cached. `UnsupportedQueryHash` rejects an
incompatible stream cache policy. Retries cannot repair it. Retire the cache before replacing its
hasher. See [Failure Handling](/effect-api-query/guides/handle-failures/) for error-stage guards and
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/#stream-creation-and-consumption)
for stream execution boundaries.

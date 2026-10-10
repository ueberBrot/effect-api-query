---
title: Retry Queries
description: Choose bounded retries by inspecting typed Effect failures and native Query options.
---

Set an explicit retry policy for an idempotent read. The callbacks below allow two retries after
an initial failure: at most three client executions. They retry a declared `RetryLater` or an HTTP
transport failure, and stop for `NotFound`, `AuthenticationRequired`, Schema failures, defects,
interruptions, and rejected runners.

## Inspect the typed failure

Share the declarations with your server and pass your application's ready client to
`rpcReadOptions` or `httpReadOptions`. Both functions return native query options for `useQuery`
or `queryClient.query`. Adapt the allowed tags and transport reasons to your read's contract.

```ts
import { Cause, Result, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  isEffectHttpApiQueryError,
  isEffectRpcQueryError,
} from 'effect-api-query'
import { HttpClientError } from 'effect/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Rpc, RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
export class AuthenticationRequired extends Schema.TaggedError<AuthenticationRequired>()(
  'AuthenticationRequired',
  {},
) {}
export class RetryLater extends Schema.TaggedError<RetryLater>()('RetryLater', {
  retryAfterMs: Schema.Finite,
}) {}

const ReadError = Schema.Union([NotFound, AuthenticationRequired, RetryLater])
export const readGroup = RpcGroup.make(
  Rpc.make('profile.read', { success: Schema.String, error: ReadError }),
)
export const readApi = HttpApi.make('profile-api').add(
  HttpApiGroup.make('profile').add(
    HttpApiEndpoint.get('read', '/profile', { success: Schema.String, error: ReadError }),
  ),
)

export const rpcReadOptions = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof readGroup>, RpcClientError.RpcClientError>,
) => {
  const rpc = createRpcQueryUtils<
    typeof readGroup,
    readonly ['profile-app'],
    RpcClientError.RpcClientError
  >(readGroup, { client, keyPrefix: ['profile-app'] })

  return rpc.profile.read.queryOptions({
    retry: (failureCount, error) => {
      if (!isEffectRpcQueryError(error) || failureCount >= 2) {
        return false
      }
      if (Cause.hasDies(error.cause) || Cause.hasInterrupts(error.cause)) {
        return false
      }
      const failure = Cause.findError(error.cause)
      if (Result.isFailure(failure) || error.cause.reasons.length !== 1) {
        return false
      }
      switch (failure.success._tag) {
        case 'RetryLater':
          return true
        case 'RpcClientError':
          return (
            failure.success.reason._tag === 'HttpError' &&
            failure.success.reason.kind === 'TransportError'
          )
        default:
          return false
      }
    },
    retryDelay: (attemptIndex, error) => {
      if (isEffectRpcQueryError(error)) {
        const failure = Cause.findError(error.cause)
        if (Result.isSuccess(failure) && failure.success._tag === 'RetryLater') {
          return Math.min(30_000, Math.max(0, failure.success.retryAfterMs))
        }
      }
      return Math.min(1_000 * 2 ** attemptIndex, 30_000)
    },
  })
}

export const httpReadOptions = (client: HttpApiClient.ForApi<typeof readApi>) => {
  const http = createHttpApiQueryUtils(readApi, { client, keyPrefix: ['profile-app'] })

  return http.profile.read.queryOptions({
    retry: (failureCount, error) => {
      if (!isEffectHttpApiQueryError(error) || failureCount >= 2) {
        return false
      }
      if (Cause.hasDies(error.cause) || Cause.hasInterrupts(error.cause)) {
        return false
      }
      const failure = Cause.findError(error.cause)
      if (Result.isFailure(failure) || error.cause.reasons.length !== 1) {
        return false
      }
      switch (failure.success._tag) {
        case 'RetryLater':
          return true
        case 'HttpClientError':
          return (
            HttpClientError.isHttpClientError(failure.success) &&
            failure.success.reason._tag === 'TransportError'
          )
        default:
          return false
      }
    },
    retryDelay: (attemptIndex, error) => {
      if (isEffectHttpApiQueryError(error)) {
        const failure = Cause.findError(error.cause)
        if (Result.isSuccess(failure) && failure.success._tag === 'RetryLater') {
          return Math.min(30_000, Math.max(0, failure.success.retryAfterMs))
        }
      }
      return Math.min(1_000 * 2 ** attemptIndex, 30_000)
    },
  })
}
```

`Cause.findError` returns a `Result`; after `Result.isSuccess`, `success` retains the declared
error union. It extracts the first typed failure. Check defects and interruptions first, and
inspect all `cause.reasons` when several failures are meaningful to your policy. This example
rejects every Cause with more than one reason, including a retryable failure combined with a defect,
interruption, or another typed failure.

The runtime guard also rejects a custom runner's original rejection. A runner rejection produces
no failed Effect `Exit`, so it need not have the statically declared execution-error shape. Keep
this guard in retry and retry-delay callbacks that can receive custom runner failures.

An HTTP `TransportError` is safe to retry here because this operation is an idempotent read. Other
`HttpClientError` reasons include encoding, decoding, and response failures. An RPC
`RpcClientError` can contain HTTP, socket, worker, or protocol failures; the RPC policy above
explicitly allows only its HTTP transport reason. Choose socket/worker reconnection policy in the
application that owns that transport. Handle expired authentication by restoring the application
session and invalidating affected queries, instead of repeatedly sending the same credentials.

`retryDelay` receives the zero-based attempt index and the same typed error. It returns milliseconds,
not an Effect or Promise. Query Core can evaluate it even for a terminal failure, so keep it pure.
The example bounds server-provided delays and caps exponential backoff at 30 seconds.

## Set defaults deliberately

| Execution                                                      | Native retry default without application overrides |
| -------------------------------------------------------------- | -------------------------------------------------- |
| Browser query observer, such as `useQuery`                     | Three retries after the initial attempt            |
| Server query observer                                          | Zero retries                                       |
| Imperative `queryClient.query` and `queryClient.infiniteQuery` | Retries disabled                                   |
| Mutation                                                       | Retries disabled                                   |

Generated options preserve Query Core policy. QueryClient defaults, prefix defaults, and explicit
builder options can change these defaults. Set `retry` explicitly when attempt counts matter;
`retry: 2` also means at most three executions, while `retry: false` permits one.

Apply the same decision in an infinite, accumulated-stream, or live builder only when restarting
that operation is safe. A stream retry starts a new stream invocation; its retained data and refetch
policy still govern cache publication. Mutation retries require an application idempotency contract.

Choose one layer to own retries. If TanStack allows two retries and the underlying Effect or
transport schedule also allows two retries per invocation, one query can make nine client attempts.
Set `retry: false` in Query options when the ready client or runner owns a retry schedule. A retry
around the runner's iterable-creation Effect does not retry subsequent stream consumption; see
[client lifecycle](/effect-api-query/concepts/client-lifecycle/#stream-creation-and-consumption).

## Handle preparation before execution

Factory and option-builder configuration errors and key-generation errors are synchronous. Prepare
options inside a `try` block when input or custom encoders may fail, then pass the successful options
to Query Core. These errors occur before a query is registered and never enter execution retry.
For an infinite query, the later page-input mapper executes during fetching; errors it throws reach
TanStack unchanged and need an explicit non-retry decision. Mutations encode input inside the
ready client's Effect, so their encoding failures use the execution Cause.

Use [failure handling](/effect-api-query/guides/handle-failures/) for error-stage guards and
[the error reference](/effect-api-query/reference/errors/) for stable metadata. See the
[complete example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/docs-retry.ts).

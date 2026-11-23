---
title: Retry Queries
description: Reuse bounded read policies with typed Effect failures and native Query options.
---

Set a shared retry policy with `configureUtils`, then use the configured leaf at each call site. Options retain native input, `select`, and initial-data types. Local options override shared defaults.

This policy allows two retries for `RetryLater` or an approved transport failure, for up to three executions. Use it for reads that are safe to repeat when the transport leaves retries to the app.

## Share the decision and delay

Import `getExecutionCause` and `retryExecutionError` from `@ueberbrot/effect-api-query`. Import `Cause`, `Result`, and `Schema` from `effect`. Declare `RetryLater` with a finite `retryAfterMs` field and share the helper between RPC and HTTP.

```ts
const retryPolicy = (isTransient: (failure: unknown) => boolean) => ({
  retry: retryExecutionError({
    maxRetries: 2,
    shouldRetry: (failure) =>
      Schema.is(RetryLater)(failure) || isTransient(failure),
  }),
  retryDelay: (attemptIndex: number, error: unknown) => {
    const cause = getExecutionCause(error);
    if (cause) {
      const failure = Cause.findError(cause);
      if (Result.isSuccess(failure) && Schema.is(RetryLater)(failure.success)) {
        return Math.min(30_000, Math.max(0, failure.success.retryAfterMs));
      }
    }
    return Math.min(1_000 * 2 ** attemptIndex, 30_000);
  },
});
```

`retryExecutionError` calls `shouldRetry` only for a single typed failure from either execution wrapper. It stops on defects, interruptions, composite Causes, and unwrapped runner failures. Omit `maxRetries` to allow up to three retries.

## Bind a typed RPC policy

Import `configureUtils` from `@ueberbrot/effect-api-query`. Import `RpcClientError` from `effect/rpc`. After you build `rpc`, attach the policy to the profile read.

```ts
const read = configureUtils(rpc.profile.read, {
  query: retryPolicy(
    (failure) =>
      Schema.is(RpcClientError.RpcClientError)(failure) &&
      failure.reason._tag === "HttpError" &&
      failure.reason.kind === "TransportError"
  ),
});
return read.queryOptions();
```

This example retries only RPC failures from HTTP transport. Configure WebSocket or worker reconnects where you own the transport.

## Bind the same decision to HTTP

Import `HttpClientError` from `effect/http`. Reuse the helper with HTTP's transport classifier.

```ts
const read = configureUtils(http.profile.read, {
  query: retryPolicy(
    (failure) =>
      HttpClientError.isHttpClientError(failure) &&
      failure.reason._tag === "TransportError"
  ),
});
return read.queryOptions();
```

The policy stops on encoding, decoding, response, `NotFound`, and authentication failures. Restore an expired session before invalidating its queries.

See the [compiled example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-retry.ts) for both contracts and factories. See [defaults and policies](/effect-api-query/guides/query-defaults/) for precedence.

## Set defaults deliberately

| Execution | Native retry default without application overrides |
| --- | --- |
| Browser query observer, such as `useQuery` | Three retries after the initial attempt |
| Server query observer | Zero retries |
| Imperative `queryClient.query` and `queryClient.infiniteQuery` | Retries disabled |
| Mutation | Retries disabled |

QueryClient defaults still apply. Set `retry: 2` for up to three runs or `retry: false` for one.

Choose one layer to retry. Two retries in TanStack and two per run in Effect can make nine client attempts. If you need to retry a stream's pulls, attach recovery to consumption. Restart only operations that are safe to repeat. Stream policies still control cache writes. Retrying a mutation requires application idempotency.

`retryDelay` takes a zero-based index and returns milliseconds. Keep it free of side effects because Query Core can evaluate it for the final failure. This recipe caps both server delays and exponential backoff at 30 seconds.

## Handle preparation before execution

Build options inside `try` if input or custom encoders can fail. Factory, builder, and key failures throw before execution and bypass retry. Page mappers run during execution and pass thrown errors through. The ready client encodes mutation input inside Effect, so failures carry a Cause.

Keep hashing stable while entries are cached. Retrying `UnsupportedQueryHash` cannot fix incompatible hashing. Retire the cache before changing its hasher. See [error handling](/effect-api-query/guides/handle-failures/) and [stream execution](/effect-api-query/concepts/client-lifecycle/#stream-creation-and-consumption).

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  isEffectHttpApiQueryError,
  isEffectRpcQueryError,
  withQueryPolicy,
} from '@ueberbrot/effect-api-query'
import type { InferQueryError } from '@ueberbrot/effect-api-query'
import { Cause, Result, Schema } from 'effect'
import { HttpClientError } from 'effect/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Rpc, RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
class AuthenticationRequired extends Schema.TaggedError<AuthenticationRequired>()(
  'AuthenticationRequired',
  {},
) {}
class RetryLater extends Schema.TaggedError<RetryLater>()('RetryLater', {
  retryAfterMs: Schema.Finite,
}) {}

const ReadError = Schema.Union([NotFound, AuthenticationRequired, RetryLater])
const readGroup = RpcGroup.make(
  Rpc.make('profile.read', { success: Schema.String, error: ReadError }),
)
const readApi = HttpApi.make('profile-api').add(
  HttpApiGroup.make('profile').add(
    HttpApiEndpoint.get('read', '/profile', { success: Schema.String, error: ReadError }),
  ),
)

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

const rpcReadOptions = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof readGroup>, RpcClientError.RpcClientError>,
) => {
  const rpc = createRpcQueryUtils<
    typeof readGroup,
    readonly ['profile-app'],
    RpcClientError.RpcClientError
  >(readGroup, { client, keyPrefix: ['profile-app'] })

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
}

const httpReadOptions = (client: HttpApiClient.ForApi<typeof readApi>) => {
  const http = createHttpApiQueryUtils(readApi, { client, keyPrefix: ['profile-app'] })

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
}

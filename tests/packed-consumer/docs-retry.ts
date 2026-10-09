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
  retryAfterMs: Schema.Number,
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

import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  getExecutionCause,
  retryExecutionError,
} from "@ueberbrot/effect-api-query";
import { Cause, Result, Schema } from "effect";
import { HttpClientError } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { Rpc, RpcClient, RpcClientError, RpcGroup } from "effect/rpc";
class NotFound extends Schema.TaggedError<
  NotFound,
  {
    readonly brand: unique symbol;
  }
>()("NotFound", {}) {}
class AuthenticationRequired extends Schema.TaggedError<
  AuthenticationRequired,
  {
    readonly brand: unique symbol;
  }
>()("AuthenticationRequired", {}) {}
class RetryLater extends Schema.TaggedError<
  RetryLater,
  {
    readonly brand: unique symbol;
  }
>()("RetryLater", {
  retryAfterMs: Schema.Finite,
}) {}
const ReadError = Schema.Union([NotFound, AuthenticationRequired, RetryLater]);
const readGroup = RpcGroup.make(
  Rpc.make("profile.read", { success: Schema.String, error: ReadError })
);
const readApi = HttpApi.make("profile-api").add(
  HttpApiGroup.make("profile").add(
    HttpApiEndpoint.get("read", "/profile", {
      success: Schema.String,
      error: ReadError,
    })
  )
);
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
        return Math.min(30000, Math.max(0, failure.success.retryAfterMs));
      }
    }
    return Math.min(1000 * 2 ** attemptIndex, 30000);
  },
});
const rpcReadOptions = (
  client: RpcClient.RpcClient.Flat<
    RpcGroup.Rpcs<typeof readGroup>,
    RpcClientError.RpcClientError
  >
) => {
  const rpc = createRpcQueryUtils<
    typeof readGroup,
    readonly ["profile-app"],
    RpcClientError.RpcClientError
  >(readGroup, { client, keyPrefix: ["profile-app"] });
  const read = configureUtils(rpc.profile.read, {
    query: {
      policy: retryPolicy(
        (failure) =>
          Schema.is(RpcClientError.RpcClientError)(failure) &&
          failure.reason._tag === "HttpError" &&
          failure.reason.kind === "TransportError"
      ),
    },
  });
  return read.queryOptions();
};
const httpReadOptions = (client: HttpApiClient.ForApi<typeof readApi>) => {
  const http = createHttpApiQueryUtils(readApi, {
    client,
    keyPrefix: ["profile-app"],
  });
  const read = configureUtils(http.profile.read, {
    query: {
      policy: retryPolicy(
        (failure) =>
          HttpClientError.isHttpClientError(failure) &&
          failure.reason._tag === "TransportError"
      ),
    },
  });
  return read.queryOptions();
};

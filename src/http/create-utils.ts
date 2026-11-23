import { HttpApi } from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

import type { CheckedConfiguration } from "../core/configure-utils";
import type { KeyPrefix, OptionalKeyPrefix, RuntimeInput } from "../core/types";
import { createUtilityTree } from "../core/utility-tree";
import { compileHttpOperations } from "./operation";
import type {
  CreateHttpApiQueryUtilsOptions,
  HttpApiQueryUtils,
} from "./types";

/**
 * Derives a frozen TanStack Query utility tree with lazy-memoized leaves from an Effect HttpApi contract.
 *
 * The caller retains ownership of the ready HTTP client, transport, and runtime lifecycle.
 *
 * @throws {@link EffectHttpApiQueryConfigError} if the prefix, paths, or encoders are invalid.
 */
export function createHttpApiQueryUtils<
  const Api extends HttpApi.Constraint,
  Client extends HttpApiClient.ForApi<Api, unknown, unknown>,
>(
  api: Api,
  options: CreateHttpApiQueryUtilsOptions<Api, readonly [], Client>
): HttpApiQueryUtils<Api, readonly [], Client>;
export function createHttpApiQueryUtils<
  const Api extends HttpApi.Constraint,
  const Prefix extends KeyPrefix,
  Client extends HttpApiClient.ForApi<Api, unknown, unknown>,
>(
  api: Api,
  options: CreateHttpApiQueryUtilsOptions<Api, Prefix, Client>
): HttpApiQueryUtils<Api, Prefix, Client>;
export function createHttpApiQueryUtils(
  api: HttpApi.Constraint,
  options: {
    readonly client: object;
    readonly keyPrefix?: OptionalKeyPrefix | undefined;
    readonly keyEncoders?: object | undefined;
    readonly runtime?: RuntimeInput | undefined;
  }
): object {
  if (!HttpApi.isHttpApi(api)) {
    throw new TypeError("Expected an Effect HttpApi declaration");
  }
  const { operations, errors, keyEncoders } = compileHttpOperations(
    api,
    options.client,
    options.keyEncoders
  );
  const hasKeyPrefix = "keyPrefix" in options;
  return createUtilityTree(operations, {
    hasKeyPrefix,
    keyPrefix: options.keyPrefix,
    keyNamespace: ["http", api.identifier],
    keyEncoders,
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    runtime: options.runtime as RuntimeInput<unknown> | undefined,
    errors,
  });
}

/** Checks a reusable policy map against an HTTP API without acquiring a client. */
export function defineHttpApiPolicy<
  const Api extends HttpApi.Constraint,
  const Configuration extends object,
>(
  api: Api,
  configuration: CheckedConfiguration<HttpApiQueryUtils<Api>, Configuration>
): Configuration;

export function defineHttpApiPolicy<
  const Api extends HttpApi.Constraint,
  const Prefix extends KeyPrefix,
  const Configuration extends object,
>(
  api: Api,
  configuration: CheckedConfiguration<
    HttpApiQueryUtils<Api, Prefix>,
    Configuration
  >,
  options: { readonly keyPrefix: Prefix }
): Configuration;

export function defineHttpApiPolicy<const Configuration extends object>(
  _api: HttpApi.Constraint,
  configuration: Configuration,
  _options?: { readonly keyPrefix: KeyPrefix }
): Configuration {
  return configuration;
}

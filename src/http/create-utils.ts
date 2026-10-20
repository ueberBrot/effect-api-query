import { HttpApi } from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

import type { JsonValue, RunPromiseExit } from "../core/types";
import { createUtilityTree } from "../core/utility-tree";
import { compileHttpOperations } from "./operation";
import type {
  CreateHttpApiQueryUtilsOptions,
  HttpApiQueryUtils,
} from "./types";

export const createHttpApiQueryUtils = <
  const Api extends HttpApi.Constraint,
  const Prefix extends readonly [JsonValue, ...JsonValue[]],
  Client extends HttpApiClient.ForApi<Api, unknown, unknown>,
>(
  api: Api,
  options: CreateHttpApiQueryUtilsOptions<Api, Prefix, Client>
): HttpApiQueryUtils<Api, Prefix, Client> => {
  if (!HttpApi.isHttpApi(api)) {
    throw new TypeError("Expected an Effect HttpApi declaration");
  }
  const { operations, errors, keyEncoders } = compileHttpOperations(
    api,
    options.client,
    options.keyEncoders
  );
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const runPromiseExit = options.runPromiseExit as
    | RunPromiseExit<unknown>
    | undefined;
  const tree = createUtilityTree(operations, {
    keyPrefix: options.keyPrefix,
    keyNamespace: ["http", api.identifier],
    keyEncoders,
    runPromiseExit,
    errors,
  });
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return tree as HttpApiQueryUtils<Api, Prefix, Client>;
};

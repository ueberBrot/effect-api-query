import type { HttpApi, HttpApiClient } from 'effect/http-api'

import type { JsonValue, RunPromiseExit } from '../core/types'
import { createUtilityTree } from '../core/utility-tree'
import { compileHttpOperations } from './operation'
import type { CreateHttpApiQueryUtilsOptions, HttpApiQueryUtils } from './types'

export const createHttpApiQueryUtils = <
  const Api extends HttpApi.Constraint,
  const Prefix extends readonly [JsonValue, ...JsonValue[]],
  Client extends HttpApiClient.ForApi<Api, unknown, unknown>,
>(
  api: Api,
  options: CreateHttpApiQueryUtilsOptions<Api, Prefix, Client>,
): HttpApiQueryUtils<Api, Prefix, Client> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const runtimeApi = api as unknown as HttpApi.Top
  const { operations, errors, keyEncoders } = compileHttpOperations(
    runtimeApi,
    options.client,
    options.keyEncoders,
  )
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const runPromiseExit = options.runPromiseExit as RunPromiseExit<unknown> | undefined
  const tree = createUtilityTree(operations, {
    keyPrefix: options.keyPrefix,
    keyNamespace: ['http', runtimeApi.identifier],
    keyEncoders,
    runPromiseExit,
    errors,
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return tree as HttpApiQueryUtils<Api, Prefix, Client>
}

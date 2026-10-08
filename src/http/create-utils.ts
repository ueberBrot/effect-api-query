import type { HttpApi, HttpApiClient } from 'effect/http-api'

import type { JsonValue, RunPromiseExit } from '../core/types'
import { createUtilityTree } from '../core/utility-tree'
import { compileHttpOperations } from './operation'
import type { CreateHttpApiQueryUtilsOptions, HttpApiQueryUtils } from './types'

/** Derives a frozen utility tree from buffered endpoints and a caller-owned ready HTTP client. */
export const createHttpApiQueryUtils = <
  const Api extends HttpApi.Constraint,
  const Prefix extends readonly [JsonValue, ...JsonValue[]],
  Client extends HttpApiClient.ForApi<Api, unknown, unknown>,
>(
  api: Api,
  options: CreateHttpApiQueryUtilsOptions<Api, Prefix, Client>,
): HttpApiQueryUtils<Api, Prefix, Client> => {
  // SAFETY: Api extends HttpApi.Constraint; this erases endpoint type parameters
  // only for metadata traversal, preserving the original Api in the public result.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const runtimeApi = api as unknown as HttpApi.Top
  const { operations, errors, keyEncoders } = compileHttpOperations(
    runtimeApi,
    options.client,
    options.keyEncoders,
  )
  // SAFETY: Public options require a runner when the ready client retains services;
  // the runtime tree forwards the same runner without changing its Context.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const runPromiseExit = options.runPromiseExit as RunPromiseExit<unknown> | undefined
  const tree = createUtilityTree(operations, {
    keyPrefix: options.keyPrefix,
    keyNamespace: ['http', runtimeApi.identifier],
    keyEncoders,
    runPromiseExit,
    errors,
  })
  // SAFETY: The compiled operations retain this Api's endpoint identities and ready
  // client; packed type fixtures verify its generated builder overloads and channels.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return tree as HttpApiQueryUtils<Api, Prefix, Client>
}

import type { HttpApi, HttpApiClient } from 'effect/unstable/httpapi'

import type { RuntimeKeyEncoder } from '../core/operation'
import type { JsonValue, RunPromiseExit } from '../core/types'
import { createUtilityTree } from '../core/utility-tree'
import { extractHttpEndpoints, httpTreeErrors } from './operation'
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
  const runtimeApi = api as unknown as HttpApi.Top
  const operations = extractHttpEndpoints(runtimeApi, options.client)
  const errors = httpTreeErrors(runtimeApi, operations)
  const encoderGroups = new Set(
    operations
      .filter((operation) => operation.input._tag === 'Input')
      .map((operation) => operation.identity.groupId),
  )
  const keyEncoders = new Map<string, RuntimeKeyEncoder>()
  for (const [groupId, endpoints] of Object.entries(options.keyEncoders ?? {})) {
    if (!encoderGroups.has(groupId)) throw errors.unknownEncoder(JSON.stringify([groupId]))
    for (const [endpoint, encoder] of Object.entries(endpoints as object)) {
      keyEncoders.set(JSON.stringify([groupId, endpoint]), encoder as RuntimeKeyEncoder)
    }
  }
  return createUtilityTree(operations, {
    keyPrefix: options.keyPrefix,
    keyNamespace: ['http', runtimeApi.identifier],
    keyEncoders,
    runPromiseExit: options.runPromiseExit as RunPromiseExit<unknown> | undefined,
    errors,
  }) as HttpApiQueryUtils<Api, Prefix, Client>
}

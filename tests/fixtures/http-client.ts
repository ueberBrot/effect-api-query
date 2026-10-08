import type { HttpApi, HttpApiClient } from 'effect/http-api'

/** An inert ready-client fixture for tests that only construct keys and options. */
export const unusedHttpClientFor = <Api extends HttpApi.Constraint>(
  _api: Api,
): HttpApiClient.ForApi<Api> => {
  const client = {}
  // SAFETY: key-only tests never invoke a method; absent methods fail if accidentally executed.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return client as HttpApiClient.ForApi<Api>
}

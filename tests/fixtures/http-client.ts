import type { HttpApi, HttpApiClient } from 'effect/http-api'

export const unusedHttpClientFor = <Api extends HttpApi.Constraint>(
  _api: Api,
): HttpApiClient.ForApi<Api> => {
  const client = {}
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return client as HttpApiClient.ForApi<Api>
}

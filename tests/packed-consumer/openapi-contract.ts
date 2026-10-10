import { QueryClient } from '@tanstack/query-core'
import { createHttpApiQueryUtils } from 'effect-api-query'
import type { HttpApiClient } from 'effect/http-api'
import createClient from 'openapi-fetch'

import { events, report, revision, uploaded } from './docs-openapi.ts'
import { api, Report } from './openapi-api.ts'
import type { operations, paths } from './openapi-generated.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
declare function assertType<T extends true>(): void
assertType<Equal<NonNullable<typeof report.data>['total'], string>>()
assertType<Equal<typeof revision, string | null>>()
assertType<Equal<NonNullable<typeof uploaded.data>['fileName'], string>>()
assertType<Equal<NonNullable<typeof events.data>, ReadableStream<Uint8Array<ArrayBuffer>>>>()

declare const ready: HttpApiClient.ForApi<typeof api>
const http = createHttpApiQueryUtils(api, { client: ready, keyPrefix: ['external'] })
const external = createClient<paths>({ baseUrl: 'https://external.test' })
const encoded = {
  params: {
    path: { id: '5' },
    query: { limit: '2', labels: ['a b', 'c+d'] },
    header: { 'x-factor': '3' },
  },
  body: { amount: '7', title: 'Quarter 1' },
}
const response = external.POST('/reports/{id}', encoded)
type ExternalData = NonNullable<Awaited<typeof response>['data']>
assertType<Equal<ExternalData['total'], string>>()
assertType<Equal<ExternalData['labels'], string[]>>()
declare const dto: ExternalData
// @ts-expect-error
dto.summary()
// @ts-expect-error
external.GET('/reports/{id}', encoded)
// @ts-expect-error
external.POST('/reports/5', encoded)
// @ts-expect-error
external.POST('/reports/{id}', { ...encoded, body: { amount: 7, title: 'Quarter 1' } })
// @ts-expect-error
external.POST('/reports/{id}', { body: encoded.body })
const missing = external.POST('/reports/{id}', {
  ...encoded,
  params: { ...encoded.params, path: { id: '-1' } },
})
type DeclaredFailure = NonNullable<Awaited<typeof missing>['error']>
assertType<Equal<DeclaredFailure['_tag'], 'Missing'>>()
assertType<
  Equal<
    operations['reports.update']['responses'][409]['content']['application/json']['_tag'],
    'Conflict'
  >
>()

const native = new QueryClient().query(
  http.reports.read.queryOptions({
    input: {
      params: { id: 5 },
      query: { limit: 2, labels: ['a b', 'c+d'] },
      headers: { 'x-factor': 3 },
      payload: { amount: 7, title: 'Quarter 1' },
    },
  }),
)
assertType<Equal<Awaited<typeof native>['body'], Report>>()
assertType<Equal<Awaited<typeof native>['headers']['x-revision'], number>>()
// @ts-expect-error
createHttpApiQueryUtils(api, { client: external, keyPrefix: ['external'] })
// @ts-expect-error
http.reports.read.queryOptions({ input: encoded })

type UploadBody = operations['reports.upload']['requestBody']['content']['multipart/form-data']
assertType<Equal<UploadBody['file'], Blob>>()
external.POST('/reports/{id}/files', {
  params: { path: { id: '5' }, query: { revision: '3' }, header: { 'x-kind': 'document' } },
  body: { title: 'Notes', file: new File(['contents'], 'notes.txt') },
  bodySerializer: (body) => {
    const data = new FormData()
    data.set('title', body.title)
    data.set('file', body.file)
    return data
  },
})
const raw = external.GET('/reports/events/{channel}', {
  params: { path: { channel: 'values' } },
  parseAs: 'stream',
})
assertType<
  Equal<NonNullable<Awaited<typeof raw>['data']>, ReadableStream<Uint8Array<ArrayBuffer>>>
>()
declare const bytes: NonNullable<Awaited<typeof raw>['data']>
// @ts-expect-error
bytes.summary()

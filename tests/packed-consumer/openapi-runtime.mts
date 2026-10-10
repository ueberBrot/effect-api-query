import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Cause, Effect, FileSystem, Layer, Result, Stream } from 'effect'
import { createHttpApiQueryUtils, isEffectHttpApiQueryError } from 'effect-api-query'
import {
  Etag,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpPlatform,
  HttpRouter,
} from 'effect/http'
import { HttpApiBuilder, HttpApiClient, HttpApiSchema, OpenApi } from 'effect/http-api'
import { deepStrictEqual, equal, match, ok, rejects } from 'node:assert/strict'
import createClient from 'openapi-fetch'

import { api, Report } from './openapi-api.ts'
import type { paths } from './openapi-generated.ts'

const handlers = HttpApiBuilder.group(api, 'reports', (group) =>
  group
    .handle('read', ({ params, query, headers, payload }) =>
      params.id < 0
        ? Effect.fail({ _tag: 'Missing' as const, id: params.id })
        : Effect.succeed(
            HttpApiSchema.withHeaders({
              body: new Report({
                total: params.id + query.limit + headers['x-factor'] + payload.amount,
                labels: [...query.labels],
                title: payload.title,
              }),
              headers: { 'x-revision': 4, etag: '"revision-4"' },
            }),
          ),
    )
    .handle('update', ({ headers, payload }) =>
      headers['if-match'] === '"revision-4"'
        ? Effect.succeed(payload.title)
        : Effect.fail({ _tag: 'Conflict' as const, expected: '"revision-4"' }),
    )
    .handle('list', () => Effect.succeed([{ id: 1, title: 'First' }]))
    .handle(
      'upload',
      Effect.fnUntraced(function* ({ params, query, headers, payload }) {
        const fs = yield* FileSystem.FileSystem
        const contents = yield* fs.readFileString(payload.file.path).pipe(Effect.orDie)
        return {
          id: params.id,
          revision: query.revision,
          kind: headers['x-kind'],
          title: payload.title,
          fileName: payload.file.name,
          contents,
        }
      }),
    )
    .handle('watch', ({ params }) =>
      Effect.succeed(
        params.channel === 'failure'
          ? Stream.concat(
              Stream.succeed(1),
              Stream.fail({ _tag: 'Expired' as const, reason: 'resume' }),
            )
          : Stream.make(1, 2),
      ),
    )
    .handle('records', () =>
      Effect.succeed(Stream.make({ id: 'v1', event: 'changed' as const, data: 'first' })),
    ),
)
const platform = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  Etag.layerWeak,
  HttpPlatform.layer.pipe(Layer.provide(NodeFileSystem.layer)),
)
const web = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(api).pipe(Layer.provide(handlers), Layer.provideMerge(platform)),
  { disableLogger: true },
)
const external = createClient<paths>({ baseUrl: 'https://external.test', fetch: web.handler })
const sent: Request[] = []
external.use({
  onRequest: async ({ request }) => {
    const body = await request.clone().arrayBuffer()
    sent.push(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        ...(body.byteLength === 0 ? {} : { body }),
      }),
    )
  },
})
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
try {
  const options = {
    params: {
      path: { id: '5' },
      query: { limit: '2', labels: ['a b', 'c+d'] },
      header: { 'x-factor': '3' },
    },
    body: { amount: '7', title: 'Quarter 1' },
  }
  const result = await external.POST('/reports/{id}', options)
  equal(result.error, undefined)
  deepStrictEqual(result.data, { total: '17', labels: ['a b', 'c+d'], title: 'Quarter 1' })
  equal(result.data instanceof Report, false)
  equal(result.response.status, 203)
  equal(result.response.headers.get('x-revision'), '4')
  equal(result.response.headers.get('etag'), '"revision-4"')
  equal(result.response.bodyUsed, true)
  const request = sent[0]
  ok(request !== undefined)
  equal(request.method, 'POST')
  const url = new URL(request.url)
  equal(url.pathname, '/reports/5')
  equal(url.searchParams.get('limit'), '2')
  deepStrictEqual(url.searchParams.getAll('labels'), ['a b', 'c+d'])
  equal(request.headers.get('x-factor'), '3')
  equal(request.headers.get('content-type'), 'application/json')
  deepStrictEqual(await request.json(), { amount: '7', title: 'Quarter 1' })
  const singleton = await external.POST('/reports/{id}', {
    ...options,
    params: { ...options.params, query: { limit: '2', labels: ['only'] } },
  })
  equal(singleton.response.status, 203)
  deepStrictEqual(singleton.data, { total: '17', labels: ['only'], title: 'Quarter 1' })

  const decodedWire = await web.handler(
    new Request('https://external.test/reports/5?limit=2&labels=one&labels=two', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-factor': '3' },
      body: JSON.stringify({ amount: 7, title: 'Quarter 1' }),
    }),
  )
  equal(decodedWire.status, 400)
  const missing = await external.POST('/reports/{id}', {
    ...options,
    params: { ...options.params, path: { id: '-1' } },
  })
  equal(missing.data, undefined)
  equal(missing.response.status, 404)
  deepStrictEqual(missing.error, { _tag: 'Missing', id: -1 })
  const conflict = await external.PATCH('/reports/{id}', {
    params: { path: { id: '5' }, header: { 'if-match': 'stale' } },
    body: { title: 'Changed' },
  })
  equal(conflict.response.status, 409)
  deepStrictEqual(conflict.error, { _tag: 'Conflict', expected: '"revision-4"' })
  const updated = await external.PATCH('/reports/{id}', {
    params: { path: { id: '5' }, header: { 'if-match': '"revision-4"' } },
    body: { title: 'Changed' },
  })
  equal(updated.data, 'Changed')
  const patchRequest = sent.find((item) => item.method === 'PATCH')
  ok(patchRequest !== undefined)
  equal(new URL(patchRequest.url).pathname, '/reports/5')
  equal(patchRequest.headers.get('if-match'), 'stale')
  deepStrictEqual(await patchRequest.json(), { title: 'Changed' })
  deepStrictEqual((await external.GET('/reports')).data, [{ id: 1, title: 'First' }])

  const client = await Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://external.test',
      httpClient: HttpClient.make(
        Effect.fnUntraced(function* (request) {
          const outgoing = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
          const response = yield* Effect.promise(() => web.handler(outgoing))
          return HttpClientResponse.fromWeb(request, response)
        }),
      ),
    }),
  )
  const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['external'] })
  const metadata = await queryClient.query(
    http.reports.read.metadataOptions({
      input: {
        params: { id: 5 },
        query: { limit: 2, labels: ['a b', 'c+d'] },
        headers: { 'x-factor': 3 },
        payload: { amount: 7, title: 'Quarter 1' },
      },
    }),
  )
  ok(metadata.data.body instanceof Report)
  equal(metadata.data.body.summary(), 'Quarter 1: 17')
  equal(metadata.data.headers['x-revision'], 4)
  equal(metadata.status, 203)
  equal(metadata.headers['x-revision'], '4')
  equal(metadata.headers['etag'], '"revision-4"')
  equal(Object.isFrozen(metadata), true)
  equal(Object.isFrozen(metadata.headers), true)

  const uploadOptions = {
    params: {
      path: { id: '5' },
      query: { revision: '3' },
      header: { 'x-kind': 'document' },
    },
    body: {
      title: 'Release notes',
      file: new File(['first upload'], 'notes.txt', { type: 'text/plain' }),
    },
  }
  equal((await external.POST('/reports/{id}/files', uploadOptions)).response.status, 415)
  const upload = await external.POST('/reports/{id}/files', {
    ...uploadOptions,
    bodySerializer: (body) => {
      const data = new FormData()
      data.set('title', body.title)
      data.set('file', body.file)
      return data
    },
  })
  const expectedUpload = {
    id: 5,
    revision: 3,
    kind: 'document',
    title: 'Release notes',
    fileName: 'notes.txt',
    contents: 'first upload',
  }
  equal(upload.error, undefined)
  deepStrictEqual(upload.data, expectedUpload)
  const uploadRequest = sent.at(-1)
  ok(uploadRequest !== undefined)
  equal(uploadRequest.method, 'POST')
  equal(new URL(uploadRequest.url).pathname, '/reports/5/files')
  equal(new URL(uploadRequest.url).searchParams.get('revision'), '3')
  equal(uploadRequest.headers.get('x-kind'), 'document')
  match(uploadRequest.headers.get('content-type') ?? '', /^multipart\/form-data; boundary=/u)
  const form = await uploadRequest.formData()
  equal(form.get('title'), 'Release notes')
  const file = form.get('file')
  ok(file instanceof File)
  equal(file.name, 'notes.txt')
  equal(await file.text(), 'first upload')
  const nativeBody = new FormData()
  nativeBody.set('title', 'Release notes')
  nativeBody.set('file', uploadOptions.body.file)
  deepStrictEqual(
    await new MutationObserver(queryClient, http.reports.upload.mutationOptions()).mutate({
      params: { id: 5 },
      query: { revision: 3 },
      headers: { 'x-kind': 'document' },
      payload: nativeBody,
    }),
    expectedUpload,
  )

  await rejects(
    external.GET('/reports/events/{channel}', { params: { path: { channel: 'values' } } }),
    SyntaxError,
  )
  const streamed = await external.GET('/reports/events/{channel}', {
    params: { path: { channel: 'values' } },
    parseAs: 'stream',
  })
  ok(streamed.data instanceof ReadableStream)
  equal(streamed.response.headers.get('content-type'), 'text/event-stream')
  equal(await new Response(streamed.data).text(), 'data: "1"\n\ndata: "2"\n\n')
  const records = await external.GET('/reports/records', { parseAs: 'text' })
  equal(records.data, 'id: v1\nevent: changed\ndata: first\n\n')
  const streamFailure = await external.GET('/reports/events/{channel}', {
    params: { path: { channel: 'failure' } },
    parseAs: 'text',
  })
  equal(streamFailure.response.status, 200)
  equal(streamFailure.error, undefined)
  match(streamFailure.data ?? '', /^data: "1"\n\nevent: effect\/http-api\/stream\/failure\ndata: /u)
  match(streamFailure.data ?? '', /"_tag":"Expired","reason":"resume"/u)
  deepStrictEqual(
    await queryClient.query(
      http.reports.watch.streamedOptions({ input: { params: { channel: 'values' } } }),
    ),
    [1, 2],
  )
  equal(
    await queryClient.query(
      http.reports.watch.liveOptions({ input: { params: { channel: 'values' } } }),
    ),
    2,
  )
  await rejects(
    queryClient.query(
      http.reports.watch.streamedOptions({ input: { params: { channel: 'failure' } } }),
    ),
    (error: unknown) => {
      ok(isEffectHttpApiQueryError(error))
      const failure = Cause.findError(error.cause)
      ok(Result.isSuccess(failure))
      deepStrictEqual(failure.success, { _tag: 'Expired', reason: 'resume' })
      return true
    },
  )
  const document = OpenApi.fromApi(api)
  const streaming =
    document.paths['/reports/events/{channel}']?.get?.responses['200']?.content?.[
      'text/event-stream'
    ]
  equal(streaming?.['x-effect-stream']?.encoding, 'sse')
  equal(streaming?.['x-effect-stream']?.failureEvent, 'effect/http-api/stream/failure')
} finally {
  queryClient.clear()
  await web.dispose()
}

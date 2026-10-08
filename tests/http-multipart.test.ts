import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse, Multipart } from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'
import { describe, expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils } from '#effect-api-query'

import { unusedHttpClientFor } from './fixtures/http-client'

const UploadResult = Schema.Struct({
  url: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  fileName: Schema.String,
  contents: Schema.String,
})
const UploadApi = HttpApi.make('uploads').add(
  HttpApiGroup.make('files').add(
    HttpApiEndpoint.post('upload', '/folders/:id/uploads', {
      params: { id: Schema.FiniteFromString },
      query: { revision: Schema.FiniteFromString },
      headers: { 'x-kind': Schema.String },
      payload: Schema.Struct({ title: Schema.String, file: Multipart.SingleFileSchema }).pipe(
        HttpApiSchema.asMultipart(),
      ),
      success: UploadResult,
    }),
  ),
)

describe('HTTP multipart mutations', () => {
  it('rejects key encoders for retained multipart mutation endpoints', () => {
    // SAFETY: JavaScript callers can configure an encoder that the published type contract rejects.
    /* oxlint-disable typescript/no-unsafe-type-assertion */
    const options = {
      client: unusedHttpClientFor(UploadApi),
      keyPrefix: ['test'],
      keyEncoders: { files: { upload: () => null } },
    } as never
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    expect(() => createHttpApiQueryUtils(UploadApi, options)).toThrow(
      expect.objectContaining({
        _tag: 'EffectHttpApiQueryConfigError',
        code: 'UnknownKeyEncoder',
        apiId: 'uploads',
      }),
    )
  })

  it('sends a file and text fields with decoded request parts through the ready HTTP client', async () => {
    const client = await Effect.runPromise(
      HttpApiClient.makeWith(UploadApi, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
            const body = yield* Effect.promise(async () => await web.formData())
            const file = body.get('file')
            if (!(file instanceof File)) {
              return yield* Effect.die(new Error('Expected a multipart file'))
            }
            const contents = yield* Effect.promise(async () => await file.text())
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                url: web.url,
                kind: web.headers.get('x-kind'),
                title: body.get('title'),
                fileName: file.name,
                contents,
              }),
            )
          }),
        ),
      }),
    )
    const utils = createHttpApiQueryUtils(UploadApi, { client, keyPrefix: ['test'] })
    const payload = new FormData()
    payload.set('title', 'Release notes')
    payload.set('file', new File(['first upload'], 'notes.txt', { type: 'text/plain' }))
    const queryClient = new QueryClient()
    try {
      await expect(
        new MutationObserver(queryClient, utils.files.upload.mutationOptions()).mutate({
          params: { id: 7 },
          query: { revision: 3 },
          headers: { 'x-kind': 'document' },
          payload,
        }),
      ).resolves.toStrictEqual({
        url: 'https://example.test/folders/7/uploads?revision=3',
        kind: 'document',
        title: 'Release notes',
        fileName: 'notes.txt',
        contents: 'first upload',
      })
    } finally {
      queryClient.clear()
    }
  })
})

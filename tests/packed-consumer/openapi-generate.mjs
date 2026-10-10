import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Path } from 'effect'
import { OpenApi } from 'effect/http-api'
import openapiTS, { astToString } from 'openapi-typescript'
import ts from 'typescript'

import { api } from './openapi-api.ts'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* path.fromFileUrl(new URL('.', import.meta.url))
  const document = OpenApi.fromApi(api)
  const source = yield* Effect.promise(() =>
    openapiTS(JSON.stringify(document), {
      transform: (schema) =>
        schema.format === 'binary' ? ts.factory.createTypeReferenceNode('Blob') : undefined,
    }),
  )
  yield* fs.writeFileString(
    path.join(directory, 'openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  )
  yield* fs.writeFileString(
    path.join(directory, 'openapi-generated.ts'),
    astToString(source, { formatOptions: { removeComments: true } }),
  )
})
NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))

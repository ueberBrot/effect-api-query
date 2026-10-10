import { OpenApi } from 'effect/http-api'
import { writeFileSync } from 'node:fs'
import openapiTS, { astToString } from 'openapi-typescript'
import ts from 'typescript'

import { api } from './openapi-api.ts'

const document = OpenApi.fromApi(api)
const source = await openapiTS(JSON.stringify(document), {
  transform: (schema) =>
    schema.format === 'binary' ? ts.factory.createTypeReferenceNode('Blob') : undefined,
})
writeFileSync(`${import.meta.dirname}/openapi.json`, `${JSON.stringify(document, null, 2)}\n`)
writeFileSync(
  `${import.meta.dirname}/openapi-generated.ts`,
  astToString(source, { formatOptions: { removeComments: true } }),
)

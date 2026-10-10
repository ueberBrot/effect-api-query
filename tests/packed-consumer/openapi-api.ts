import { Schema } from 'effect'
import { Multipart } from 'effect/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

export class Report extends Schema.Class<Report>('external-http/Report')({
  total: Schema.NumberFromString,
  labels: Schema.Array(Schema.String),
  title: Schema.String,
}) {
  summary() {
    return `${this.title}: ${this.total}`
  }
}

const Missing = Schema.TaggedStruct('Missing', { id: Schema.Number }).pipe(
  HttpApiSchema.status(404),
)
const Conflict = Schema.TaggedStruct('Conflict', { expected: Schema.String }).pipe(
  HttpApiSchema.status(409),
)
const Expired = Schema.TaggedStruct('Expired', { reason: Schema.String })

export const api = HttpApi.make('external-http').add(
  HttpApiGroup.make('reports').add(
    HttpApiEndpoint.post('read', '/reports/:id', {
      params: { id: Schema.NumberFromString },
      query: { limit: Schema.NumberFromString, labels: Schema.Array(Schema.String) },
      headers: { 'x-factor': Schema.NumberFromString },
      payload: Schema.Struct({ amount: Schema.NumberFromString, title: Schema.String }),
      success: HttpApiSchema.WithHeaders(Report, {
        'x-revision': Schema.NumberFromString,
        etag: Schema.String,
      }).pipe(HttpApiSchema.status(203)),
      error: Missing,
    }),
    HttpApiEndpoint.patch('update', '/reports/:id', {
      params: { id: Schema.NumberFromString },
      headers: { 'if-match': Schema.String },
      payload: Schema.Struct({ title: Schema.String }),
      success: Schema.String,
      error: Conflict,
    }),
    HttpApiEndpoint.get('list', '/reports', {
      success: Schema.Array(Schema.Struct({ id: Schema.Number, title: Schema.String })),
    }),
    HttpApiEndpoint.post('upload', '/reports/:id/files', {
      params: { id: Schema.NumberFromString },
      query: { revision: Schema.NumberFromString },
      headers: { 'x-kind': Schema.String },
      payload: Schema.Struct({ title: Schema.String, file: Multipart.SingleFileSchema }).pipe(
        HttpApiSchema.asMultipart(),
      ),
      success: Schema.Struct({
        id: Schema.Number,
        revision: Schema.Number,
        kind: Schema.String,
        title: Schema.String,
        fileName: Schema.String,
        contents: Schema.String,
      }),
    }),
    HttpApiEndpoint.get('watch', '/reports/events/:channel', {
      params: { channel: Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.NumberFromString, error: Expired }),
    }),
    HttpApiEndpoint.get('records', '/reports/records', {
      success: HttpApiSchema.StreamSse({
        events: Schema.Struct({
          id: Schema.String,
          event: Schema.Literal('changed'),
          data: Schema.String,
        }),
      }),
    }),
  ),
)

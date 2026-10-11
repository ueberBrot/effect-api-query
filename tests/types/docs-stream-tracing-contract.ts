import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

export const feedApi = HttpApi.make('feed-api').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/events', {
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
  ),
)

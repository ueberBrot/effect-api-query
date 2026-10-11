import { Effect, Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
export const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      query: {
        locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
      },
      success: User,
    }),
    HttpApiEndpoint.post('create', '/users', {
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
    }),
  ),
)

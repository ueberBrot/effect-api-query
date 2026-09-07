import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/unstable/httpapi'

import {
  DiagnosticFailure,
  DiagnosticStatus,
  ExampleAuthorizationError,
  User,
  UserPage,
} from './contracts.ts'

export class ExampleHttpAuthorization extends HttpApiMiddleware.Service<ExampleHttpAuthorization>()(
  '@effect-api-query/contracts/ExampleHttpAuthorization',
  { error: ExampleAuthorizationError.pipe(HttpApiSchema.status(401)) },
) {}

const missingUser = Schema.Literal('user-not-found').pipe(HttpApiSchema.status(404))

const users = HttpApiGroup.make('users').add(
  HttpApiEndpoint.get('list', '/users', { success: Schema.Array(User) }),
  HttpApiEndpoint.get('get', '/users/:id', {
    params: { id: Schema.Int },
    query: { locale: Schema.optionalKey(Schema.String) },
    success: User,
    error: missingUser,
  }),
  HttpApiEndpoint.post('create', '/users', {
    payload: Schema.Struct({ name: Schema.String, locale: Schema.optionalKey(Schema.String) }),
    success: User,
  }),
  HttpApiEndpoint.delete('delete', '/users/:id', {
    params: { id: Schema.Int },
    success: HttpApiSchema.NoContent,
    error: missingUser,
  }).middleware(ExampleHttpAuthorization),
  HttpApiEndpoint.get('page', '/users/page', {
    query: {
      cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      pageSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
    },
    success: UserPage,
  }),
)

const diagnostics = HttpApiGroup.make('diagnostics').add(
  HttpApiEndpoint.get('fail', '/diagnostics/fail', {
    success: Schema.Never,
    error: DiagnosticFailure.pipe(HttpApiSchema.status(422)),
  }),
  HttpApiEndpoint.get('slow', '/diagnostics/slow', {
    query: {
      durationMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60_000 })),
      operationId: Schema.String,
    },
    success: Schema.String,
  }),
  HttpApiEndpoint.get('operationStatus', '/diagnostics/operations/:operationId', {
    params: { operationId: Schema.String },
    success: DiagnosticStatus,
  }),
  HttpApiEndpoint.get('status', '/diagnostics/status', {
    success: DiagnosticStatus,
  }),
)

export const exampleHttpApi = HttpApi.make('ExampleApi').add(users, diagnostics).prefix('/api')

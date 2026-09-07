import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup, RpcMiddleware } from 'effect/unstable/rpc'

export class User extends Schema.Class<User>('User')({
  id: Schema.Int,
  locale: Schema.String,
  name: Schema.String,
}) {}

export class SeedUser extends Schema.Class<SeedUser>('SeedUser')({
  locale: Schema.String.pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed('en')),
  ),
  name: Schema.String,
}) {}

export class UserPage extends Schema.Class<UserPage>('UserPage')({
  nextCursor: Schema.NullOr(Schema.Int),
  total: Schema.Int,
  users: Schema.Array(User),
}) {}

export class DiagnosticFailure extends Schema.TaggedError<DiagnosticFailure>()(
  'DiagnosticFailure',
  {
    reason: Schema.Literal('requested-failure'),
  },
) {}

export class ExampleAuthorizationError extends Schema.TaggedError<ExampleAuthorizationError>()(
  'ExampleAuthorizationError',
  {
    reason: Schema.Literal('missing-example-authorization'),
  },
) {}

export class ExampleAuthorization extends RpcMiddleware.Service<ExampleAuthorization>()(
  '@effect-api-query/contracts/ExampleAuthorization',
  { error: ExampleAuthorizationError },
) {}

export class CommandStatus extends Schema.Class<CommandStatus>('CommandStatus')({
  operationId: Schema.String,
  state: Schema.Literals(['running', 'completed', 'cancelled']),
  completedSteps: Schema.Int,
  totalSteps: Schema.Int,
}) {}

const CommandsStart = Rpc.make('commands.start', {
  payload: {
    operationId: Schema.String,
    steps: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
      Schema.withConstructorDefault(Effect.succeed(40)),
    ),
  },
  success: CommandStatus,
})

const CommandsStatus = Rpc.make('commands.status', {
  payload: { operationId: Schema.String },
  success: Schema.NullOr(CommandStatus),
})

const CommandsCancel = Rpc.make('commands.cancel', {
  payload: { operationId: Schema.String },
  success: CommandStatus,
})

export type CommandPayload = Rpc.Payload<typeof CommandsStart>

const UsersGet = Rpc.make('users.get', {
  payload: {
    id: Schema.Int,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('en')),
    ),
  },
  success: User,
  error: Schema.Literal('user-not-found'),
})

const UsersList = Rpc.make('users.list', {
  success: Schema.Array(User),
})

const UsersPage = Rpc.make('users.page', {
  payload: {
    cursor: Schema.Int,
    pageSize: Schema.Int,
  },
  success: UserPage,
})

const UsersCreate = Rpc.make('users.create', {
  payload: SeedUser,
  success: User,
})

const UsersDelete = Rpc.make('users.delete', {
  payload: { id: Schema.Int },
  success: Schema.Void,
  error: Schema.Literal('user-not-found'),
}).middleware(ExampleAuthorization)

const TestingReset = Rpc.make('testing.reset', {
  success: Schema.Void,
})

const TestingSeed = Rpc.make('testing.seed', {
  payload: { users: Schema.Array(SeedUser) },
  success: Schema.Array(User),
})

const DiagnosticsSlow = Rpc.make('diagnostics.slow', {
  payload: {
    durationMs: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed(60_000)),
    ),
    operationId: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('anonymous')),
    ),
  },
  success: Schema.String,
})

export type SlowDiagnosticInput = Rpc.PayloadConstructor<typeof DiagnosticsSlow>

const DiagnosticsCancel = Rpc.make('diagnostics.cancel', {
  payload: { operationId: Schema.String },
  success: Schema.Void,
})

const DiagnosticsStatusRpc = Rpc.make('diagnostics.status', {
  success: Schema.Struct({
    interrupted: Schema.Int,
    started: Schema.Int,
  }),
})

export type DiagnosticStatus = Rpc.Success<typeof DiagnosticsStatusRpc>

const DiagnosticsFail = Rpc.make('diagnostics.fail', {
  success: Schema.Never,
  error: DiagnosticFailure,
})

const DiagnosticsStream = Rpc.make('diagnostics.stream', {
  success: Schema.String,
  stream: true,
})

export const exampleRpcGroup = RpcGroup.make(
  CommandsStart,
  CommandsStatus,
  CommandsCancel,
  UsersGet,
  UsersList,
  UsersPage,
  UsersCreate,
  UsersDelete,
  TestingReset,
  TestingSeed,
  DiagnosticsSlow,
  DiagnosticsCancel,
  DiagnosticsStatusRpc,
  DiagnosticsFail,
  DiagnosticsStream,
)

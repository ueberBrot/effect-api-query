// oxlint-disable eslint/max-classes-per-file
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";

export class User extends Schema.Class<User, { readonly brand: unique symbol }>(
  "User"
)({
  id: Schema.Int,
  locale: Schema.String,
  name: Schema.String,
}) {}

export class SeedUser extends Schema.Class<
  SeedUser,
  { readonly brand: unique symbol }
>("SeedUser")({
  locale: Schema.String.pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed("en"))
  ),
  name: Schema.String,
}) {}

export class UserPage extends Schema.Class<
  UserPage,
  { readonly brand: unique symbol }
>("UserPage")({
  nextCursor: Schema.NullOr(Schema.Int),
  total: Schema.Int,
  users: Schema.Array(User),
}) {}

// oxlint-disable-next-line unicorn/throw-new-error
export class DiagnosticFailure extends Schema.TaggedError<
  DiagnosticFailure,
  { readonly brand: unique symbol }
>()("DiagnosticFailure", {
  reason: Schema.Literal("requested-failure"),
}) {
  // fallow-ignore-next-line unused-class-member
  override get message(): string {
    return this.reason;
  }
}

// oxlint-disable-next-line unicorn/throw-new-error
export class ExampleAuthorizationError extends Schema.TaggedError<
  ExampleAuthorizationError,
  { readonly brand: unique symbol }
>()("ExampleAuthorizationError", {
  reason: Schema.Literal("missing-example-authorization"),
}) {}

export class ExampleAuthorization extends RpcMiddleware.Service<ExampleAuthorization>()(
  "@effect-api-query/contracts/ExampleAuthorization",
  { error: ExampleAuthorizationError }
) {}

export const operationSessionPath = "/api/demo-operations";

export const OperationNotFound = Schema.Literal("operation-not-found");

const operationLookupError = Schema.Union([
  ExampleAuthorizationError,
  OperationNotFound,
]);

const OperationId = { operationId: Schema.String };

export class CommandStatus extends Schema.Class<
  CommandStatus,
  { readonly brand: unique symbol }
>("CommandStatus")({
  operationId: Schema.String,
  state: Schema.Literals(["running", "completed", "cancelled"]),
  completedSteps: Schema.Int,
  totalSteps: Schema.Int,
}) {}

const CommandsStart = Rpc.make("commands.start", {
  payload: {
    operationId: Schema.String,
    steps: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 100 })
    ).pipe(Schema.withConstructorDefault(Effect.succeed(40))),
  },
  success: CommandStatus,
  error: ExampleAuthorizationError,
});

const CommandsReserve = Rpc.make("commands.reserve", {
  payload: OperationId,
  success: Schema.Void,
  error: ExampleAuthorizationError,
});

const CommandsStatus = Rpc.make("commands.status", {
  payload: OperationId,
  success: Schema.NullOr(CommandStatus),
  error: operationLookupError,
});

const CommandsCancel = Rpc.make("commands.cancel", {
  payload: OperationId,
  success: CommandStatus,
  error: operationLookupError,
});

export type CommandPayload = Rpc.Payload<typeof CommandsStart>;

const UsersGet = Rpc.make("users.get", {
  payload: {
    id: Schema.Int,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed("en"))
    ),
  },
  success: User,
  error: Schema.Literal("user-not-found"),
});

const UsersList = Rpc.make("users.list", {
  success: Schema.Array(User),
});

const UsersPage = Rpc.make("users.page", {
  payload: {
    cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    pageSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  },
  success: UserPage,
});

const UsersCreate = Rpc.make("users.create", {
  payload: SeedUser,
  success: User,
});

const UsersDelete = Rpc.make("users.delete", {
  payload: { id: Schema.Int },
  success: Schema.Void,
  error: Schema.Literal("user-not-found"),
}).middleware(ExampleAuthorization);

const DiagnosticsSlow = Rpc.make("diagnostics.slow", {
  payload: {
    durationMs: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed(60_000))
    ),
    operationId: Schema.optionalKey(Schema.String),
  },
  success: Schema.String,
  error: ExampleAuthorizationError,
});

export type SlowDiagnosticInput = Rpc.PayloadConstructor<
  typeof DiagnosticsSlow
>;

const DiagnosticsCancel = Rpc.make("diagnostics.cancel", {
  payload: OperationId,
  success: Schema.Void,
  error: operationLookupError,
});

const DiagnosticsPing = Rpc.make("diagnostics.ping", { success: Schema.Void });

// oxlint-disable-next-line eslint/no-redeclare
export const DiagnosticStatus = Schema.Struct({
  interrupted: Schema.Int,
  started: Schema.Int,
});

export type DiagnosticStatus = typeof DiagnosticStatus.Type;

// oxlint-disable-next-line eslint/no-redeclare
export const DiagnosticOperationStatus = Schema.Struct({
  ...DiagnosticStatus.fields,
  completed: Schema.Int,
});

export type DiagnosticOperationStatus = typeof DiagnosticOperationStatus.Type;

const DiagnosticsStatusRpc = Rpc.make("diagnostics.status", {
  success: DiagnosticStatus,
  error: ExampleAuthorizationError,
});

const DiagnosticsOperationStatus = Rpc.make("diagnostics.operationStatus", {
  payload: OperationId,
  success: DiagnosticOperationStatus,
  error: operationLookupError,
});

const DiagnosticsFail = Rpc.make("diagnostics.fail", {
  success: Schema.Never,
  error: DiagnosticFailure,
});

const DiagnosticsStream = Rpc.make("diagnostics.stream", {
  success: Schema.String,
  stream: true,
});

export const exampleRpcGroup = RpcGroup.make(
  CommandsStart,
  CommandsReserve,
  CommandsStatus,
  CommandsCancel,
  UsersGet,
  UsersList,
  UsersPage,
  UsersCreate,
  UsersDelete,
  DiagnosticsSlow,
  DiagnosticsCancel,
  DiagnosticsStatusRpc,
  DiagnosticsOperationStatus,
  DiagnosticsPing,
  DiagnosticsFail,
  DiagnosticsStream
);

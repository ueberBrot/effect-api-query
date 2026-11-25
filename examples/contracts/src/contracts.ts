// oxlint-disable eslint/max-classes-per-file
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";

export const directoryLimits = {
  nameLength: 128,
  localeLength: 32,
  revisionLength: 64,
  users: 128,
  previewSize: 16,
  maxPageSize: 100,
} as const;

export const UserLocale = Schema.String.check(
  Schema.isMaxLength(directoryLimits.localeLength)
);
const UserName = Schema.String.check(
  Schema.isMaxLength(directoryLimits.nameLength)
);

export const UserIdentity = {
  id: Schema.Int,
  revision: Schema.NonEmptyString.check(
    Schema.isMaxLength(directoryLimits.revisionLength)
  ),
} as const;

export class User extends Schema.Class<User, { readonly brand: unique symbol }>(
  "User"
)({
  ...UserIdentity,
  locale: UserLocale,
  name: UserName,
}) {}

export class SeedUser extends Schema.Class<
  SeedUser,
  { readonly brand: unique symbol }
>("SeedUser")({
  locale: UserLocale.pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed("en"))
  ),
  name: UserName,
}) {}

export const UserWriteInput = Schema.Struct(SeedUser.fields);

export const DirectoryFirstPage = Schema.Array(User).check(
  Schema.isMaxLength(directoryLimits.previewSize)
);

export const UserPageInput = {
  cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pageSize: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: directoryLimits.maxPageSize })
  ),
};

export class UserPage extends Schema.Class<
  UserPage,
  { readonly brand: unique symbol }
>("UserPage")({
  nextCursor: Schema.NullOr(Schema.Int),
  total: Schema.Int,
  users: Schema.Array(User).check(
    Schema.isMaxLength(directoryLimits.maxPageSize)
  ),
}) {}

export const DirectoryCapacityExceeded = Schema.Literal(
  "directory-capacity-exceeded"
);
export const DirectoryWriteQuotaExceeded = Schema.Literal(
  "directory-write-quota-exceeded"
);
export const InvalidUserInput = Schema.Literal("invalid-user-input");

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

export const InvalidOperationInput = Schema.Literal("invalid-operation-input");
export const OperationCapacityExceeded = Schema.Literal(
  "operation-capacity-exceeded"
);

const operationInputErrors = [ExampleAuthorizationError, InvalidOperationInput];
const operationLookupError = Schema.Union([
  ...operationInputErrors,
  OperationNotFound,
]);
const operationAdmissionError = Schema.Union([
  ...operationInputErrors,
  OperationCapacityExceeded,
]);

export const OperationId = Schema.String.check(Schema.isMaxLength(100));
export const CommandSteps = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 100 })
);
export const maxDiagnosticDurationMs = 60_000;
export const DiagnosticDuration = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: maxDiagnosticDurationMs })
);
const operationIdPayload = { operationId: OperationId };

export class CommandStatus extends Schema.Class<
  CommandStatus,
  { readonly brand: unique symbol }
>("CommandStatus")({
  operationId: OperationId,
  state: Schema.Literals(["running", "completed", "cancelled"]),
  completedSteps: Schema.Int,
  totalSteps: Schema.Int,
}) {}

const CommandsStart = Rpc.make("commands.start", {
  payload: {
    ...operationIdPayload,
    steps: CommandSteps.pipe(Schema.withConstructorDefault(Effect.succeed(40))),
  },
  success: CommandStatus,
  error: operationAdmissionError,
});

const CommandsReserve = Rpc.make("commands.reserve", {
  payload: operationIdPayload,
  success: Schema.Void,
  error: operationAdmissionError,
});

const CommandsStatus = Rpc.make("commands.status", {
  payload: operationIdPayload,
  success: Schema.NullOr(CommandStatus),
  error: operationLookupError,
});

const CommandsCancel = Rpc.make("commands.cancel", {
  payload: operationIdPayload,
  success: CommandStatus,
  error: operationLookupError,
});

export type CommandPayload = Rpc.Payload<typeof CommandsStart>;

const UsersGet = Rpc.make("users.get", {
  payload: {
    id: Schema.Int,
    locale: UserLocale.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed("en"))
    ),
  },
  success: User,
  error: Schema.Union([Schema.Literal("user-not-found"), InvalidUserInput]),
});

const UsersList = Rpc.make("users.list", {
  success: DirectoryFirstPage,
});

const UsersPage = Rpc.make("users.page", {
  payload: UserPageInput,
  success: UserPage,
});

const UsersCreate = Rpc.make("users.create", {
  payload: SeedUser,
  success: User,
  error: Schema.Union([
    InvalidUserInput,
    DirectoryCapacityExceeded,
    DirectoryWriteQuotaExceeded,
  ]),
});

const UsersDelete = Rpc.make("users.delete", {
  payload: UserIdentity,
  success: Schema.Void,
  error: Schema.Literal("user-not-found"),
}).middleware(ExampleAuthorization);

const DiagnosticsSlow = Rpc.make("diagnostics.slow", {
  payload: {
    durationMs: DiagnosticDuration.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed(maxDiagnosticDurationMs))
    ),
    operationId: Schema.optionalKey(OperationId),
  },
  success: Schema.String,
  error: operationAdmissionError,
});

export type SlowDiagnosticInput = Rpc.PayloadConstructor<
  typeof DiagnosticsSlow
>;

const DiagnosticsCancel = Rpc.make("diagnostics.cancel", {
  payload: operationIdPayload,
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
  payload: operationIdPayload,
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

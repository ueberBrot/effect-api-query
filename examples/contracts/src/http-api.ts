import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";

import {
  DiagnosticDuration,
  DiagnosticFailure,
  DiagnosticOperationStatus,
  DiagnosticStatus,
  DirectoryCapacityExceeded,
  DirectoryFirstPage,
  ExampleAuthorizationError,
  InvalidOperationInput,
  InvalidUserInput,
  OperationCapacityExceeded,
  OperationId,
  OperationNotFound,
  SeedUser,
  User,
  UserIdentity,
  UserLocale,
  UserPage,
  UserPageInput,
} from "./contracts.ts";

const unauthorized = ExampleAuthorizationError.pipe(HttpApiSchema.status(401));

export class ExampleHttpAuthorization extends HttpApiMiddleware.Service<ExampleHttpAuthorization>()(
  "@effect-api-query/contracts/ExampleHttpAuthorization",
  { error: unauthorized }
) {}

const missingUser = Schema.Literal("user-not-found").pipe(
  HttpApiSchema.status(404)
);
const invalidUser = InvalidUserInput.pipe(HttpApiSchema.status(400));

const users = HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("list", "/users", { success: DirectoryFirstPage }),
  HttpApiEndpoint.get("get", "/users/:id", {
    params: { id: Schema.Int },
    query: { locale: Schema.optionalKey(UserLocale) },
    success: User,
    error: [missingUser, invalidUser],
  }),
  HttpApiEndpoint.post("create", "/users", {
    payload: Schema.Struct(SeedUser.fields),
    success: User,
    error: [
      invalidUser,
      DirectoryCapacityExceeded.pipe(HttpApiSchema.status(409)),
    ],
  }),
  HttpApiEndpoint.delete("delete", "/users/:id", {
    params: { id: Schema.Int },
    query: { revision: UserIdentity.revision },
    success: HttpApiSchema.NoContent,
    error: missingUser,
  }).middleware(ExampleHttpAuthorization),
  HttpApiEndpoint.get("page", "/users/page", {
    query: UserPageInput,
    success: UserPage,
  })
);

const invalidOperation = InvalidOperationInput.pipe(HttpApiSchema.status(400));

const diagnostics = HttpApiGroup.make("diagnostics").add(
  HttpApiEndpoint.get("fail", "/diagnostics/fail", {
    success: Schema.Never,
    error: DiagnosticFailure.pipe(HttpApiSchema.status(422)),
  }),
  HttpApiEndpoint.post("slow", "/diagnostics/slow", {
    query: {
      durationMs: DiagnosticDuration,
      operationId: OperationId,
    },
    success: Schema.String,
    error: [
      unauthorized,
      invalidOperation,
      OperationCapacityExceeded.pipe(HttpApiSchema.status(503)),
    ],
  }),
  HttpApiEndpoint.get(
    "operationStatus",
    "/diagnostics/operations/:operationId",
    {
      params: { operationId: OperationId },
      success: DiagnosticOperationStatus,
      error: [
        unauthorized,
        invalidOperation,
        OperationNotFound.pipe(HttpApiSchema.status(404)),
      ],
    }
  ),
  HttpApiEndpoint.get("status", "/diagnostics/status", {
    success: DiagnosticStatus,
    error: unauthorized,
  })
);

export const exampleHttpApi = HttpApi.make("ExampleApi")
  .add(users, diagnostics)
  .prefix("/api");

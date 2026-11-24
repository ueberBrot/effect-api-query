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
  ExampleAuthorizationError,
  InvalidOperationInput,
  OperationCapacityExceeded,
  OperationId,
  OperationNotFound,
  User,
  UserIdentity,
  UserPage,
} from "./contracts.ts";

const unauthorized = ExampleAuthorizationError.pipe(HttpApiSchema.status(401));

export class ExampleHttpAuthorization extends HttpApiMiddleware.Service<ExampleHttpAuthorization>()(
  "@effect-api-query/contracts/ExampleHttpAuthorization",
  { error: unauthorized }
) {}

const missingUser = Schema.Literal("user-not-found").pipe(
  HttpApiSchema.status(404)
);

const users = HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("list", "/users", { success: Schema.Array(User) }),
  HttpApiEndpoint.get("get", "/users/:id", {
    params: { id: Schema.Int },
    query: { locale: Schema.optionalKey(Schema.String) },
    success: User,
    error: missingUser,
  }),
  HttpApiEndpoint.post("create", "/users", {
    payload: Schema.Struct({
      name: Schema.String,
      locale: Schema.optionalKey(Schema.String),
    }),
    success: User,
  }),
  HttpApiEndpoint.delete("delete", "/users/:id", {
    params: { id: Schema.Int },
    query: { revision: UserIdentity.revision },
    success: HttpApiSchema.NoContent,
    error: missingUser,
  }).middleware(ExampleHttpAuthorization),
  HttpApiEndpoint.get("page", "/users/page", {
    query: {
      cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      pageSize: Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: 100 })
      ),
    },
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

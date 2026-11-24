import { OperationNotFound } from "@effect-api-query/contracts";
import { Cause, Result } from "effect";

// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const isOperationNotFound = (error: unknown): boolean =>
  error instanceof Error &&
  Cause.isCause(error.cause) &&
  Result.getOrUndefined(Cause.findError(error.cause)) ===
    OperationNotFound.literal;

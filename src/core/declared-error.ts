import type { Cause } from "effect";
import { Option, Predicate } from "effect";

import { isEffectHttpApiQueryError } from "../http/errors";
import type { EffectHttpApiQueryError } from "../http/errors";
import { isEffectRpcQueryError } from "../rpc/errors";
import type { EffectRpcQueryError } from "../rpc/errors";

export type ExecutionError<Failure> =
  | EffectRpcQueryError<Failure>
  | EffectHttpApiQueryError<Failure>;

export type ExecutionFailure<Error> =
  ExecutionError<unknown> extends Error
    ? unknown
    : Error extends ExecutionError<infer Failure>
      ? Failure
      : never;

export type FailureOf<Error> = Error extends {
  readonly cause: Cause.Cause<infer Failure>;
}
  ? Failure
  : never;

export type Tagged<Failure> = Extract<Failure, { readonly _tag: string }>;
export type TaggedFailure<Error> = Tagged<ExecutionFailure<Error>>;

export type DeclaredErrorHandler<Failure, Result> = (
  failure: Failure
) => Result;

export type DeclaredErrorHandlers<Error> = {
  readonly [Tag in TaggedFailure<Error>["_tag"]]?: DeclaredErrorHandler<
    Extract<TaggedFailure<Error>, { readonly _tag: Tag }>,
    unknown
  >;
};

export type HandlerResult<Handlers> =
  NonNullable<Handlers[keyof Handlers]> extends infer Handler
    ? Handler extends (...args: never[]) => infer Result
      ? Result
      : never
    : never;

/** Options for building a TanStack Query retry predicate over execution errors. */
export interface RetryExecutionErrorOptions<Failure = unknown> {
  /** Decides whether to retry a single typed failure. */
  readonly shouldRetry: (failure: Failure, failureCount: number) => boolean;
  /** Maximum number of retries. Defaults to three. */
  readonly maxRetries?: number | undefined;
}

/** Recognizes RPC and HTTP execution errors from this JavaScript realm. */
export const isEffectApiQueryError = <Value>(
  value: Value
): value is Value & ExecutionError<unknown> =>
  isEffectRpcQueryError(value) || isEffectHttpApiQueryError(value);

/** Returns the original Effect Cause when this is an RPC or HTTP execution error. */
export function getExecutionCause<Error>(
  error: Error
): Cause.Cause<ExecutionFailure<Error>> | undefined;
export function getExecutionCause<Error>(error: Error) {
  return isEffectApiQueryError(error) ? error.cause : undefined;
}

const singleExecutionFailure = <Error>(error: Error) => {
  const cause = getExecutionCause(error);
  const reason = cause?.reasons[0];
  return cause?.reasons.length === 1 && reason?._tag === "Fail"
    ? Option.some(reason.error)
    : Option.none();
};

/** Matches one typed failure only; defects, interruptions and composite Causes never match. */
export function findDeclaredError<
  Error,
  Tag extends Tagged<FailureOf<Error>>["_tag"],
>(
  error: Error,
  tag: Tag
): Option.Option<Extract<Tagged<FailureOf<Error>>, { readonly _tag: Tag }>>;
export function findDeclaredError<Error>(error: Error, tag: string) {
  const failure = singleExecutionFailure(error);
  return Option.isSome(failure) &&
    Predicate.hasProperty(failure.value, "_tag") &&
    failure.value._tag === tag
    ? failure
    : Option.none();
}

const isHandler = <Value>(
  value: Value
): value is Value & DeclaredErrorHandler<unknown, unknown> =>
  Predicate.isFunction(value);

/**
 * Handles a single tagged failure. Calls `orElse` with the original error for an
 * unmatched tag, a non-execution error, a defect, an interruption, or a composite Cause.
 */
export function matchDeclaredError<
  Error,
  const Handlers extends DeclaredErrorHandlers<Error>,
  Fallback,
>(
  error: Error,
  handlers: DeclaredErrorHandlers<Error> &
    Handlers &
    Record<Exclude<keyof Handlers, keyof DeclaredErrorHandlers<Error>>, never>,
  orElse: (error: Error) => Fallback
): HandlerResult<Handlers> | Fallback;
export function matchDeclaredError<Error, Handlers, Fallback>(
  error: Error,
  handlers: Handlers,
  orElse: (error: Error) => Fallback
) {
  const failure = singleExecutionFailure(error);
  if (
    Option.isSome(failure) &&
    Predicate.hasProperty(failure.value, "_tag") &&
    Predicate.isString(failure.value._tag) &&
    Predicate.hasProperty(handlers, failure.value._tag) &&
    Object.hasOwn(handlers, failure.value._tag)
  ) {
    const handler = handlers[failure.value._tag];
    if (isHandler(handler)) {
      return handler(failure.value);
    }
  }
  return orElse(error);
}

/**
 * Builds a TanStack Query retry predicate. Only single typed failures reach
 * `shouldRetry`, and only while the zero-based failure count is below `maxRetries`.
 */
export const retryExecutionError =
  <Error = unknown>({
    shouldRetry,
    maxRetries = 3,
  }: RetryExecutionErrorOptions<ExecutionFailure<Error>>): ((
    failureCount: number,
    error: Error
  ) => boolean) =>
  (failureCount, error) => {
    if (!(failureCount < maxRetries)) {
      return false;
    }
    const failure = singleExecutionFailure(error);
    return Option.isSome(failure) && shouldRetry(failure.value, failureCount);
  };

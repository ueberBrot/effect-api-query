import type { Cause } from "effect";
import { Option, Predicate } from "effect";

import { isEffectHttpApiQueryError } from "../http/errors";
import { isEffectRpcQueryError } from "../rpc/errors";

export type FailureOf<Error> = Error extends {
  readonly cause: Cause.Cause<infer Failure>;
}
  ? Failure
  : never;
export type TaggedFailure<Error> = Extract<
  FailureOf<Error>,
  { readonly _tag: string }
>;

/** Matches one typed failure only; defects, interruptions and composite Causes never match. */
export const findDeclaredError = <
  Error,
  Tag extends TaggedFailure<Error>["_tag"],
>(
  error: Error,
  tag: Tag
): Option.Option<Extract<TaggedFailure<Error>, { readonly _tag: Tag }>> => {
  if (!isEffectRpcQueryError(error) && !isEffectHttpApiQueryError(error)) {
    return Option.none();
  }
  const [reason] = error.cause.reasons;
  if (error.cause.reasons.length !== 1 || reason?._tag !== "Fail") {
    return Option.none();
  }
  const failure = reason.error;
  if (!Predicate.hasProperty(failure, "_tag") || failure._tag !== tag) {
    return Option.none();
  }
  // SAFETY: The wrapper's typed Cause and discriminant identify the declared union member.
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const matched = failure as Extract<
    TaggedFailure<Error>,
    { readonly _tag: Tag }
  >;
  return Option.some(matched);
};

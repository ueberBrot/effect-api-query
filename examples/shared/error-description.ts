import {
  getExecutionCause,
  isEffectApiQueryError,
} from "@ueberbrot/effect-api-query";
import { Cause } from "effect";

// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const describeEffectError = (error: unknown) => {
  if (isEffectApiQueryError(error)) {
    const operation =
      "rpcTag" in error ? error.rpcTag : `${error.groupId}.${error.endpoint}`;
    const cause = getExecutionCause(error);
    return {
      summary: `${error.name} from ${operation} (${error.operation})`,
      details: cause === undefined ? undefined : Cause.pretty(cause),
    };
  }
  return error instanceof Error
    ? { summary: `${error.name}: ${error.message}` }
    : undefined;
};

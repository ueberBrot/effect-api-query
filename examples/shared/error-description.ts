import {
  isEffectHttpApiQueryError,
  isEffectRpcQueryError,
} from "@ueberbrot/effect-api-query";
import { Cause } from "effect";

// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const describeEffectError = (error: unknown) => {
  if (isEffectRpcQueryError(error) || isEffectHttpApiQueryError(error)) {
    const operation = isEffectRpcQueryError(error)
      ? error.rpcTag
      : `${error.groupId}.${error.endpoint}`;
    return {
      summary: `${error.name} from ${operation} (${error.operation})`,
      details: Cause.pretty(error.cause),
    };
  }
  return error instanceof Error
    ? { summary: `${error.name}: ${error.message}` }
    : undefined;
};

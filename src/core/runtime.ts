import { Exit, Predicate } from "effect";
import type { Cause } from "effect";

import type { BufferedOperation, UnaryQueryOperation } from "./operation";
import type { RunPromiseExit, RuntimeInput } from "./types";

export const resolveRuntime = <R>(
  runtime: RuntimeInput<R>
): RunPromiseExit<R> => {
  if (Predicate.isFunction(runtime)) {
    return runtime;
  }
  if (
    Predicate.isObject(runtime) &&
    Predicate.hasProperty(runtime, "runPromiseExit") &&
    Predicate.isFunction(runtime.runPromiseExit)
  ) {
    return async (effect, options) =>
      options === undefined
        ? await runtime.runPromiseExit(effect)
        : await runtime.runPromiseExit(effect, options);
  }
  throw new TypeError(
    "runtime must be a runPromiseExit function or an object with a runPromiseExit method"
  );
};

export const executeBuffered = async <
  Operation extends UnaryQueryOperation | "metadata",
>(
  description: {
    readonly invoke: BufferedOperation["invoke"];
    readonly executionError: (
      operation: Operation,
      cause: Cause.Cause<unknown>
    ) => Error;
  },
  operation: Operation,

  input: Parameters<BufferedOperation["invoke"]>[0],
  runPromiseExit: RunPromiseExit<unknown>,

  requestOptions?: Parameters<BufferedOperation["invoke"]>[1],
  signal?: AbortSignal
) => {
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
  const effect = description.invoke(input, requestOptions);
  const exit = await runPromiseExit(
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
    effect,
    signal === undefined ? undefined : { signal }
  );

  if (Exit.isFailure(exit)) {
    throw description.executionError(operation, exit.cause);
  }

  return operation !== "call" &&
    operation !== "mutation" &&
    exit.value === undefined
    ? null
    : exit.value;
};

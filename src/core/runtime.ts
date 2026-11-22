import { Predicate } from "effect";

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

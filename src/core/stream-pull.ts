import { Effect, Pull, Scope } from "effect";

export const closeScopeOnPullEnd = <A, E, Done, R>(
  scope: Scope.Closeable,
  pull: Pull.Pull<A, E, Done, R>
) =>
  Effect.onError(pull, (cause) =>
    Scope.close(scope, Pull.doneExitFromCause(cause))
  );

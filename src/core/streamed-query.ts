import { experimental_streamedQuery } from "@tanstack/query-core";
import type { QueryFunctionContext } from "@tanstack/query-core";
import {
  Cause,
  Effect,
  Exit,
  Predicate,
  Pull,
  Result,
  Scope,
  Stream,
} from "effect";

import { validateStreamHash } from "./stream-hash-index";
import { streamPublicationBatches } from "./stream-publication";
import type { RunPromiseExit, StreamRefetchMode } from "./types";

export type StreamQueryPolicy =
  | {
      readonly maxChunks: number | undefined;
      readonly _tag: "Accumulated";
      readonly refetchMode: StreamRefetchMode;
      readonly publicationBatchSize: number;
      readonly publicationMaxWaitMs: number | undefined;
    }
  | { readonly _tag: "Live" };

// oxlint-disable-next-line anti-slop/no-unknown-parameters
const validatePublicationDeadline: (
  value: unknown
) => asserts value is number | undefined = (publicationMaxWaitMs) => {
  if (
    publicationMaxWaitMs !== undefined &&
    (!Predicate.isNumber(publicationMaxWaitMs) ||
      !Number.isSafeInteger(publicationMaxWaitMs) ||
      publicationMaxWaitMs <= 0 ||
      publicationMaxWaitMs > 2_147_483_647)
  ) {
    throw new RangeError(
      "publicationMaxWaitMs must be an integer from 1 to 2147483647"
    );
  }
};

export const prepareStreamPolicy = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  options: Record<string, unknown>,
  operation: "live" | "streamed",
  invalid: (
    code: "InvalidMaxChunks" | "InvalidRefetchMode",
    message: string
  ) => Error
) => {
  let policy: StreamQueryPolicy;
  if (operation === "streamed") {
    const {
      maxChunks,
      refetchMode = "reset",
      publicationBatchSize = 1,
      publicationMaxWaitMs,
    } = options;
    if (
      maxChunks !== undefined &&
      (!Predicate.isNumber(maxChunks) ||
        !Number.isSafeInteger(maxChunks) ||
        maxChunks <= 0)
    ) {
      throw invalid(
        "InvalidMaxChunks",
        "maxChunks must be a positive safe integer"
      );
    }
    if (
      refetchMode !== "reset" &&
      refetchMode !== "append" &&
      refetchMode !== "replace"
    ) {
      throw invalid(
        "InvalidRefetchMode",
        "refetchMode must be reset, append, or replace"
      );
    }
    if (
      !Predicate.isNumber(publicationBatchSize) ||
      !Number.isSafeInteger(publicationBatchSize) ||
      publicationBatchSize <= 0
    ) {
      throw new RangeError(
        "publicationBatchSize must be a positive safe integer"
      );
    }
    validatePublicationDeadline(publicationMaxWaitMs);
    policy = {
      _tag: "Accumulated",
      maxChunks,
      refetchMode,
      publicationBatchSize,
      publicationMaxWaitMs,
    };
  } else {
    policy = { _tag: "Live" };
  }
  delete options["refetchMode"];
  delete options["maxChunks"];
  delete options["publicationBatchSize"];
  delete options["publicationMaxWaitMs"];
  return {
    policy,
    history:
      policy._tag === "Live"
        ? undefined
        : {
            maxChunks: policy.maxChunks ?? null,
            refetchMode: policy.refetchMode,
            ...(policy.publicationBatchSize === 1
              ? undefined
              : { publicationBatchSize: policy.publicationBatchSize }),
            ...(policy.publicationMaxWaitMs === undefined
              ? undefined
              : { publicationMaxWaitMs: policy.publicationMaxWaitMs }),
          },
  };
};

export interface MakeStreamQueryOptions {
  readonly policy: StreamQueryPolicy;
  readonly source: Stream.Stream<unknown, unknown, unknown>;
  readonly executionError: (cause: Cause.Cause<unknown>) => Error;
  readonly unsupportedHash: () => Error;
  readonly emptyError?: (() => Error) | undefined;
  readonly runPromiseExit: RunPromiseExit<unknown>;
}

const streamQueryIterable = <A>(
  source: AsyncIterable<A>,
  signal: AbortSignal,
  emptyError: (() => Error) | undefined
): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]();
    let closePromise: Promise<IteratorResult<A>> | undefined;
    let emitted = false;
    const detach = () => {
      // oxlint-disable-next-line eslint/no-use-before-define
      signal.removeEventListener("abort", onAbort);
    };
    const close = async () => {
      closePromise ??= (async () => {
        try {
          return (
            (await iterator.return?.()) ?? { done: true, value: undefined }
          );
        } finally {
          detach();
        }
      })();
      return await closePromise;
    };
    const onAbort = () => {
      // oxlint-disable-next-line promise/prefer-await-to-then
      void Promise.resolve().then(close).catch(detach);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    return {
      async next() {
        let result: IteratorResult<A>;
        if (signal.aborted) {
          result = await close();
        } else {
          try {
            result = await iterator.next();
          } catch (error) {
            detach();
            throw error;
          }
        }
        if (result.done === true) {
          detach();
          if (!emitted && emptyError !== undefined) {
            throw emptyError();
          }
        }
        emitted = true;
        return result;
      },
      return: close,
      async throw(cause?: unknown) {
        detach();
        if (iterator.throw !== undefined) {
          return await iterator.throw(cause);
        }
        await close();
        throw cause;
      },
    };
  },
});

export const makeStreamQuery = ({
  policy,
  source,
  executionError,
  unsupportedHash,
  emptyError,
  runPromiseExit,
}: MakeStreamQueryOptions) => {
  const validateHash = (context: QueryFunctionContext) =>
    validateStreamHash(context, unsupportedHash);
  const streamFn = async ({ signal }: { readonly signal: AbortSignal }) => {
    const stream = Stream.unwrap(
      Effect.gen(function* consumeStream() {
        const scope = yield* Scope.make();
        yield* Effect.addFinalizer((exit) =>
          Scope.close(scope, exit).pipe(
            Effect.catchCause((cause) => Effect.die(executionError(cause)))
          )
        );
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
        const pull = yield* Stream.toPull(source).pipe(Scope.provide(scope));
        return Stream.fromPull(
          Effect.succeed(
            Effect.uninterruptibleMask((restore) =>
              // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
              restore(pull).pipe(
                Effect.onError((cause) =>
                  Scope.close(scope, Pull.doneExitFromCause(cause))
                ),
                Effect.catchCause((cause) => {
                  const completion = Pull.filterDone(cause);
                  if (
                    Result.isFailure(completion) &&
                    (!signal.aborted ||
                      !Cause.hasInterruptsOnly(completion.failure))
                  ) {
                    return Effect.fail(executionError(completion.failure));
                  }
                  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
                  return Effect.failCause(cause);
                })
              )
            )
          )
        );
      })
    );
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
    const exit = await runPromiseExit(Stream.toAsyncIterableEffect(stream), {
      signal,
    });
    if (Exit.isFailure(exit)) {
      throw executionError(exit.cause);
    }
    return streamQueryIterable(
      exit.value,
      signal,
      policy._tag === "Live" ? emptyError : undefined
    );
  };

  if (policy._tag === "Live") {
    const queryFn = experimental_streamedQuery({
      initialValue: null,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      reducer: (_latest: unknown, value: unknown) =>
        value === undefined ? null : value,
      streamFn,
    });
    return async (context: QueryFunctionContext) => {
      validateHash(context);
      return await queryFn(context);
    };
  }

  const { maxChunks, refetchMode, publicationBatchSize, publicationMaxWaitMs } =
    policy;
  return async (context: QueryFunctionContext) => {
    const query = validateHash(context);
    const reset = refetchMode === "reset" && query?.isFetched() === true;
    let emitted = false;
    const initialValue: unknown[] = [];
    const queryFn = experimental_streamedQuery({
      initialValue,
      reducer: (values: unknown[], batch: readonly unknown[]) => {
        const history = reset && !emitted ? [] : values;
        emitted = true;
        if (maxChunks === undefined) {
          return [...history, ...batch];
        }
        const start = Math.max(0, history.length + batch.length - maxChunks);
        // oxlint-disable-next-line unicorn/no-new-array
        const next = new Array<unknown>(history.length + batch.length - start);
        for (
          let index = start;
          index < history.length + batch.length;
          index += 1
        ) {
          next[index - start] =
            index < history.length
              ? history[index]
              : batch[index - history.length];
        }
        return next;
      },
      refetchMode,
      streamFn: async (streamContext) =>
        streamPublicationBatches(
          await streamFn(streamContext),
          publicationBatchSize,
          streamContext.signal,
          publicationMaxWaitMs
        ),
    });
    const result = await queryFn(context);
    return reset && !emitted ? [] : result;
  };
};

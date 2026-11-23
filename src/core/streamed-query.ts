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
import {
  streamLiveSnapshots,
  streamPublicationBatches,
  streamQueryIterable,
} from "./stream-publication";
import { closeScopeOnPullEnd } from "./stream-pull";
import type {
  LivePolicyOptions,
  RunPromiseExit,
  StreamedPolicyOptions,
  StreamRefetchMode,
} from "./types";

export type StreamQueryPolicy =
  | {
      readonly maxChunks: number | undefined;
      readonly _tag: "Accumulated";
      readonly refetchMode: StreamRefetchMode;
      readonly publicationBatchSize: number;
      readonly publicationMaxWaitMs: number | undefined;
    }
  | { readonly _tag: "Live"; readonly coalesceMs: number | undefined };

// oxlint-disable-next-line anti-slop/no-unknown-parameters
const validatePublicationDeadline: (
  value: unknown,
  option?: string
) => asserts value is number | undefined = (
  publicationMaxWaitMs,
  option = "publicationMaxWaitMs"
) => {
  if (
    publicationMaxWaitMs !== undefined &&
    (!Predicate.isNumber(publicationMaxWaitMs) ||
      !Number.isSafeInteger(publicationMaxWaitMs) ||
      publicationMaxWaitMs <= 0 ||
      publicationMaxWaitMs > 2_147_483_647)
  ) {
    throw new RangeError(`${option} must be an integer from 1 to 2147483647`);
  }
};

const policyFields = [
  "coalesceMs",
  "maxChunks",
  "refetchMode",
  "publicationBatchSize",
  "publicationMaxWaitMs",
  "sseOptions",
];

export const isStreamPolicyOption = (
  view: "live" | "streamed",
  name: string
): boolean =>
  name === "sseOptions" ||
  (policyFields.includes(name) &&
    (name === "coalesceMs") === (view === "live"));

export type StreamPolicyFields = {
  -readonly [
    Key in keyof (StreamedPolicyOptions & LivePolicyOptions)
  ]?: (StreamedPolicyOptions & LivePolicyOptions)[Key];
} & { sseOptions?: unknown };

export const hasStreamPolicy = (options: StreamPolicyFields): boolean =>
  policyFields.some((key) => Object.hasOwn(options, key));

export const clearStreamPolicy = (options: StreamPolicyFields): void => {
  for (const key of policyFields) {
    Reflect.deleteProperty(options, key);
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
      maxChunks !== "unbounded" &&
      (!Predicate.isNumber(maxChunks) ||
        !Number.isSafeInteger(maxChunks) ||
        maxChunks <= 0)
    ) {
      throw invalid(
        "InvalidMaxChunks",
        "maxChunks must be a positive safe integer or 'unbounded'"
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
      maxChunks: maxChunks === "unbounded" ? undefined : maxChunks,
      refetchMode,
      publicationBatchSize,
      publicationMaxWaitMs,
    };
  } else {
    validatePublicationDeadline(options["coalesceMs"], "coalesceMs");
    policy = { _tag: "Live", coalesceMs: options["coalesceMs"] };
  }
  clearStreamPolicy(options);
  if (policy._tag === "Live") {
    return {
      policy,
      history:
        policy.coalesceMs === undefined
          ? undefined
          : { coalesceMs: policy.coalesceMs },
    };
  }
  return {
    policy,
    history: {
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

const consumeQueryStream = async <A, Data>(
  context: QueryFunctionContext,
  stream: AsyncIterable<A>,
  initialValue: Data,
  reducer: (previous: Data, value: A) => Data
): Promise<Data> => {
  const { client, queryKey, signal } = context;
  for await (const value of stream) {
    if (signal.aborted) {
      break;
    }
    client.setQueryData<Data>(queryKey, (previous) =>
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing
      reducer(previous === undefined ? initialValue : previous, value)
    );
  }
  const data = client.getQueryData<Data>(queryKey);
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing
  return data === undefined ? initialValue : data;
};

const consumeReplacement = async <A>(
  { client, queryKey, signal }: QueryFunctionContext,
  batches: AsyncIterable<readonly A[]>,
  maxChunks: number | undefined
): Promise<A[]> => {
  const history: A[] = [];
  let start = 0;
  for await (const batch of batches) {
    if (signal.aborted) {
      break;
    }
    for (const value of batch) {
      if (maxChunks === undefined || history.length < maxChunks) {
        history.push(value);
      } else {
        history[start] = value;
        start = (start + 1) % maxChunks;
      }
    }
  }
  if (!signal.aborted) {
    client.setQueryData<A[]>(
      queryKey,
      start === 0
        ? history
        : [...history.slice(start), ...history.slice(0, start)]
    );
  }
  return client.getQueryData<A[]>(queryKey) ?? [];
};

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
  const guardedStream = (signal: AbortSignal) =>
    Stream.unwrap(
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
              closeScopeOnPullEnd(scope, restore(pull)).pipe(
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
  const openStream = async <A>(
    stream: Stream.Stream<A, unknown, unknown>,
    signal: AbortSignal
  ) => {
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
    const exit = await runPromiseExit(Stream.toAsyncIterableEffect(stream), {
      signal,
    });
    if (Exit.isFailure(exit)) {
      throw executionError(exit.cause);
    }
    return streamQueryIterable(exit.value, signal);
  };

  if (policy._tag === "Live") {
    return async (context: QueryFunctionContext) => {
      const query = validateHash(context);
      if (query?.isFetched() === true) {
        query.setState({ ...query.resetState, fetchStatus: "fetching" });
      }
      return await consumeQueryStream(
        context,
        await openStream(
          streamLiveSnapshots(
            guardedStream(context.signal),
            policy.coalesceMs,
            emptyError
          ),
          context.signal
        ),
        null,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters
        (_latest: unknown, value: unknown) =>
          value === undefined ? null : value
      );
    };
  }

  const { maxChunks, refetchMode, publicationBatchSize, publicationMaxWaitMs } =
    policy;
  return async (context: QueryFunctionContext) => {
    const query = validateHash(context);
    const isRefetch = query?.isFetched() === true;
    const reset = refetchMode === "reset" && isRefetch;
    if (reset) {
      query.setState({ ...query.resetState, fetchStatus: "fetching" });
    }
    const batches = await openStream(
      streamPublicationBatches(
        guardedStream(context.signal),
        publicationBatchSize,
        publicationMaxWaitMs
      ),
      context.signal
    );
    if (isRefetch && refetchMode === "replace") {
      return await consumeReplacement(context, batches, maxChunks);
    }
    let emitted = false;
    const initialValue: unknown[] = [];
    const result = await consumeQueryStream(
      context,
      batches,
      initialValue,
      (values: unknown[], batch: readonly unknown[]) => {
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
      }
    );
    return reset && !emitted ? [] : result;
  };
};

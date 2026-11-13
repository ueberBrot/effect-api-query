import { ReplayExpired } from "@effect-api-query/contracts";
import type { FeedEvent, FeedScenario } from "@effect-api-query/contracts";
import {
  queryEffects,
  recoverStream,
  runQueryEvents,
} from "@ueberbrot/effect-api-query";
import { Cause, Effect, Exit, Result, Schema, Stream } from "effect";

import type { HttpWorkflows } from "./application.ts";

export const recoveredEvents = (
  { client, http, owner }: HttpWorkflows,
  scenario: typeof FeedScenario.Type,
  callbacks: {
    readonly event: (event: typeof FeedEvent.Type) => void;
    readonly state: (state: string) => void;
    readonly refresh: () => void;
  }
) => {
  const refresh = client.documents.read().pipe(
    Effect.tap((document) =>
      queryEffects
        .setData(http.documents.read.queryKey(), document)
        .pipe(Effect.andThen(Effect.sync(callbacks.refresh)))
    ),
    Effect.asVoid
  );
  const source = recoverStream({
    initialCursor: "0",
    cursorPolicy: {
      accept: (previous, next) => BigInt(next) > BigInt(previous),
      isGap: (previous, next) => BigInt(next) > BigInt(previous) + 1n,
    },
    connect: (after) =>
      Stream.unwrap(
        client.feeds.events({ query: { after: Number(after), scenario } })
      ),
    cursor: (event) => String(event.sequence),
    retryDelay: (cause, attempt) =>
      Cause.hasDies(cause) || attempt > 3 ? undefined : 200,
    isReplayExpired: (cause) => {
      const failure = Cause.findError(cause);
      return (
        Result.isSuccess(failure) && Schema.is(ReplayExpired)(failure.success)
      );
    },
    onGap: () => refresh,
    onReplayExpired: () =>
      client.feeds.snapshot().pipe(
        Effect.tap(() => refresh),
        Effect.map(({ cursor }) => String(cursor))
      ),
    onState: (state) =>
      Effect.sync(() => {
        callbacks.state(state.status);
      }),
  });
  return Effect.promise(async (signal) =>
    runQueryEvents(
      owner,
      source,
      {
        onEvent: (event) =>
          queryEffects
            .invalidate({
              queryKey: http.documents.read.queryKey(),
              refetchType: "active",
            })
            .pipe(
              Effect.andThen(
                Effect.sync(() => {
                  callbacks.event(event);
                })
              )
            ),
      },
      async (effect, options) =>
        Effect.runPromiseExit(effect, {
          signal:
            options?.signal === undefined
              ? signal
              : AbortSignal.any([signal, options.signal]),
        })
    )
  ).pipe(
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit) ? Effect.void : Effect.failCause(exit.cause)
    )
  );
};

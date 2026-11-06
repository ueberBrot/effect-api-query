import { ReplayExpired } from "@effect-api-query/contracts";
import type { FeedEvent, FeedScenario } from "@effect-api-query/contracts";
import { consumeEvents, recoverStream } from "@ueberbrot/effect-api-query";
import { Cause, Effect, Result, Schema, Stream } from "effect";

import type { HttpWorkflows } from "./application.ts";

export const recoveredEvents = (
  { client, http, queryClient }: HttpWorkflows,
  scenario: typeof FeedScenario.Type,
  callbacks: {
    readonly event: (event: typeof FeedEvent.Type) => void;
    readonly state: (state: string) => void;
    readonly refresh: () => void;
  }
) => {
  const refresh = client.documents.read().pipe(
    Effect.tap((document) =>
      Effect.sync(() => {
        queryClient.setQueryData(http.documents.read.queryKey(), document);
        callbacks.refresh();
      })
    ),
    Effect.asVoid
  );
  return consumeEvents(
    recoverStream({
      connect: (after) =>
        Stream.unwrap(client.feeds.events({ query: { after, scenario } })),
      cursor: (event) => event.sequence,
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
          Effect.map(({ cursor }) => cursor)
        ),
      onState: (state) =>
        Effect.sync(() => {
          callbacks.state(state.status);
        }),
    }),
    {
      onEvent: (event) =>
        Effect.sync(() => {
          callbacks.event(event);
        }),
    }
  );
};

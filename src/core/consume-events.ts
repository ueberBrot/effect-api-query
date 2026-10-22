import { Effect, Stream } from "effect";
import type { Exit } from "effect";

export interface ConsumeEventsOptions<
  A,
  E,
  R,
  HandlerError = never,
  HandlerServices = never,
> {
  readonly onEvent: (
    event: A
  ) => Effect.Effect<void, HandlerError, HandlerServices>;
  /** Runs before consuming; this is not a transport connection acknowledgement. */
  readonly onStart?: Effect.Effect<void, HandlerError, HandlerServices>;
  /** Runs after stream cleanup, including failure or interruption. */
  readonly onExit?: (
    exit: Exit.Exit<void, E | HandlerError>
  ) => Effect.Effect<void, never, R | HandlerServices>;
}

/** Consumes events sequentially without retaining history or owning a runtime or cache. */
export const consumeEvents = <
  A,
  E,
  R,
  HandlerError = never,
  HandlerServices = never,
>(
  source: Stream.Stream<A, E, R>,
  options: ConsumeEventsOptions<A, E, R, HandlerError, HandlerServices>
): Effect.Effect<void, E | HandlerError, R | HandlerServices> =>
  Effect.suspend(() =>
    (options.onStart ?? Effect.void).pipe(
      Effect.andThen(Stream.runForEach(source, options.onEvent)),
      Effect.onExit((exit) => options.onExit?.(exit) ?? Effect.void)
    )
  );

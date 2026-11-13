import { Effect } from "effect";
import type { Exit, Stream } from "effect";

import { consumeEvents } from "./consume-events";
import type { ConsumeEventsOptions } from "./consume-events";
import { QueryClientService } from "./query-effects";
import type { QueryOwner } from "./query-owner";
import type { RunPromiseExit } from "./types";

/**
 * Runs sequential event handlers against the originating owner's native cache.
 * Compose recoverStream before calling; the application owns cursor and domain policy.
 * The supplied runner must honor AbortSignal and await local Effect finalizers.
 * Retirement interrupts the entire consumption (including recovery hooks) and drains it.
 * Returns the complete Exit; owner admission and runner rejections remain Promise failures.
 */
export const runQueryEvents = async <A, E, R, HE, HR>(
  owner: Pick<QueryOwner<unknown>, "queryClient" | "wrapRunner">,
  source: Stream.Stream<A, E, R>,
  options: ConsumeEventsOptions<A, E, R, HE, HR>,
  runPromiseExit: RunPromiseExit<Exclude<R | HR, QueryClientService>>
): Promise<Exit.Exit<void, E | HE>> =>
  owner.wrapRunner(runPromiseExit)(
    consumeEvents(source, options).pipe(
      Effect.provideService(QueryClientService, owner.queryClient)
    ),
    // A signal registers this non-query Effect for owner retirement as well.
    { signal: new AbortController().signal }
  );

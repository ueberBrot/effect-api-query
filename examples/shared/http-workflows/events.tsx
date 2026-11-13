import { FeedScenario } from "@effect-api-query/contracts";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { useEffect, useState } from "react";

import { ActionButton } from "../ui/action-button.tsx";
import { EffectErrorDetails } from "../ui/effect-error-details.tsx";
import type { HttpWorkflows } from "./application.ts";
import { recoveredEvents } from "./recovery.ts";

export const EventsExample = ({
  application,
}: {
  readonly application: HttpWorkflows;
}) => {
  const document = useQuery(application.http.documents.read.queryOptions());
  const [scenario, setScenario] =
    useState<typeof FeedScenario.Type>("disconnect");
  const [run, setRun] = useState(0);
  const [state, setState] = useState("idle");
  const [events, setEvents] = useState<readonly number[]>([]);
  const [refreshes, setRefreshes] = useState(0);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    const consumer =
      run === 0
        ? undefined
        : application.consume(
            recoveredEvents(application, scenario, {
              event: (event) => {
                if (active) {
                  setEvents((values) => [...values, event.sequence]);
                }
              },
              state: (value) => {
                if (active) {
                  setState(value);
                }
              },
              refresh: () => {
                if (active) {
                  setRefreshes((count) => count + 1);
                }
              },
            })
          );
    void (async () => {
      try {
        await consumer?.done;
      } catch (error_) {
        if (active) {
          setError(error_);
        }
      }
    })();
    return () => {
      active = false;
      consumer?.stop();
    };
  }, [application, scenario, run]);
  return (
    <section className="grid gap-5">
      <p>
        Notifications refresh the document in the native query cache. The
        application owns replay cursors, retry delays, and authoritative
        refreshes.
      </p>
      <label className="grid gap-1">
        Delivery scenario
        <select
          className="border-border bg-background border p-2"
          value={scenario}
          disabled={run > 0 && state !== "completed" && state !== "failed"}
          onChange={(event) => {
            setRun(0);
            setScenario(
              Schema.decodeUnknownSync(FeedScenario)(event.currentTarget.value)
            );
          }}
        >
          <option value="disconnect">Disconnect and resume</option>
          <option value="gap">Refresh after a gap</option>
          <option value="expired">Refresh expired replay</option>
          <option value="normal">Complete normally</option>
        </select>
      </label>
      <div className="flex gap-3">
        <ActionButton
          disabled={run > 0 && state !== "completed" && state !== "failed"}
          onClick={() => {
            setEvents([]);
            setRefreshes(0);
            setError(undefined);
            setRun((value) => value + 1);
          }}
        >
          Consume events
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => {
            setRun(0);
            setState("stopped");
          }}
        >
          Stop event consumer
        </ActionButton>
      </div>
      <p>Current document: {document.data?.title ?? "Loading…"}</p>
      <output aria-label="Document refreshed at">
        {String(document.dataUpdatedAt)}
      </output>
      <output>Connection: {state}</output>
      <p>Delivered sequences: {events.join(", ")}</p>
      <p>Authoritative refreshes: {String(refreshes)}</p>
      <EffectErrorDetails error={error} />
    </section>
  );
};

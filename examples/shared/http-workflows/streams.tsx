import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ActionButton } from "../ui/action-button.tsx";
import { EffectErrorDetails } from "../ui/effect-error-details.tsx";
import type { HttpWorkflows } from "./application.ts";

export const StreamsExample = ({
  application,
}: {
  readonly application: HttpWorkflows;
}) => {
  const [format, setFormat] = useState<"sse" | "ndjson">("sse");
  const [running, setRunning] = useState(false);
  const sseHistoryOptions = application.http.feeds.sse.streamedOptions({
    enabled: running && format === "sse",
  });
  const ndjsonHistoryOptions = application.http.feeds.ndjson.streamedOptions({
    enabled: running && format === "ndjson",
  });
  const sseLatestOptions = application.http.feeds.sse.liveOptions({
    enabled: running && format === "sse",
  });
  const ndjsonLatestOptions = application.http.feeds.ndjson.liveOptions({
    enabled: running && format === "ndjson",
  });
  const sseHistory = useQuery(sseHistoryOptions);
  const ndjsonHistory = useQuery(ndjsonHistoryOptions);
  const sseLatest = useQuery(sseLatestOptions);
  const ndjsonLatest = useQuery(ndjsonLatestOptions);
  const history = format === "sse" ? sseHistory : ndjsonHistory;
  const latest = format === "sse" ? sseLatest : ndjsonLatest;
  const historyOptions =
    format === "sse" ? sseHistoryOptions : ndjsonHistoryOptions;
  const latestOptions =
    format === "sse" ? sseLatestOptions : ndjsonLatestOptions;
  const stop = async () => {
    setRunning(false);
    await Promise.all(
      [historyOptions, latestOptions].map(async ({ queryKey }) => {
        await application.queryClient.cancelQueries({ queryKey, exact: true });
      })
    );
  };
  return (
    <section className="grid gap-5">
      <p>
        Both formats carry the same eight decoded updates. History retains four
        values and publishes batches of three or after 180 ms. The latest-value
        view publishes immediately, then coalesces updates for 250 ms.
      </p>
      <label className="grid gap-1">
        HTTP stream format
        <select
          className="border-border bg-background border p-2"
          value={format}
          disabled={history.isFetching || latest.isFetching}
          onChange={(event) => {
            setRunning(false);
            setFormat(
              event.currentTarget.value === "ndjson" ? "ndjson" : "sse"
            );
          }}
        >
          <option value="sse">SSE</option>
          <option value="ndjson">NDJSON</option>
        </select>
      </label>
      <div className="flex gap-3">
        <ActionButton
          disabled={history.isFetching || latest.isFetching}
          onClick={() => {
            setRunning(true);
            if (running) {
              void history.refetch();
              void latest.refetch();
            }
          }}
        >
          Start streams
        </ActionButton>
        <ActionButton
          variant="secondary"
          disabled={!history.isFetching && !latest.isFetching}
          onClick={() => {
            void stop();
          }}
        >
          Stop streams
        </ActionButton>
      </div>
      <output>
        {history.isFetching || latest.isFetching
          ? "Receiving updates"
          : "Streams idle"}
      </output>
      <p>Latest update: {String(latest.data?.sequence ?? 0)}</p>
      <ol aria-label="Retained HTTP history">
        {history.data?.map((event) => (
          <li key={event.sequence}>{event.message}</li>
        ))}
      </ol>
      <EffectErrorDetails error={history.error ?? latest.error} />
    </section>
  );
};

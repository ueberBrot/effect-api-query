import { Room } from "@effect-api-query/contracts";
import type { Reading } from "@effect-api-query/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  createQueryFilter,
  prepareInput,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ActionButton } from "../components/ui/action-button.tsx";
import { EffectErrorDetails } from "../components/ui/effect-error-details.tsx";
import type { HttpWorkflows } from "./application.ts";
import { shareReadings } from "./sharing.ts";

const ReadingCardView = ({ reading }: { readonly reading: Reading }) => {
  const renders = useRef(0);
  const counter = useRef<HTMLOutputElement>(null);
  useLayoutEffect(() => {
    renders.current += 1;
    if (counter.current !== null) {
      counter.current.textContent = String(renders.current);
    }
  });
  return (
    <li className="border-border border p-4">
      Reading {String(reading.id)}: {String(reading.value)} at{" "}
      {reading.observedAt.toISOString()}
      <p>
        Committed renders: <output ref={counter} />
      </p>
    </li>
  );
};
const ReadingCard = memo(ReadingCardView);

export const ReadingsExample = ({
  application,
}: {
  readonly application: HttpWorkflows;
}) => {
  const [sharing, setSharing] = useState(true);
  const [room, setRoom] = useState<typeof Room.Type>("lab");
  const read = useMemo(
    () =>
      configureUtils(application.http.readings.read, {
        query: { policy: { structuralSharing: shareReadings } },
      }),
    [application]
  );
  const input = useMemo(
    () => prepareInput(read, { query: { room } }),
    [read, room]
  );
  const rooms = useMemo(
    () =>
      createQueryFilter(
        application.http.readings.read,
        "query",
        (selected: typeof Room.Type) => ({ query: { room: selected } })
      ),
    [application]
  );
  const query = useQuery(
    read.queryOptions({
      input,
      structuralSharing: sharing ? shareReadings : false,
    })
  );
  const mutation = useMutation(
    application.http.readings.change.mutationOptions({
      onSuccess: async (_saved, variables) => {
        await application.queryClient.invalidateQueries(
          rooms(variables.payload.room)
        );
      },
    })
  );
  return (
    <section className="grid gap-5">
      <p>
        Each fetch decodes fresh Schema classes and dates. With schema-defined
        sharing, equivalent readings retain their references and memoized cards
        keep their render counts.
      </p>
      <label className="grid gap-1">
        Room
        <select
          value={room}
          onChange={(event) => {
            setRoom(Schema.decodeUnknownSync(Room)(event.currentTarget.value));
          }}
        >
          <option value="lab">Lab</option>
          <option value="office">Office</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={sharing}
          onChange={(event) => {
            setSharing(event.currentTarget.checked);
          }}
        />{" "}
        Reuse equivalent decoded readings
      </label>
      <div className="flex gap-3">
        <ActionButton
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          Refetch equal readings
        </ActionButton>
        <ActionButton
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            mutation.mutate({ payload: { room } });
          }}
        >
          Change first reading
        </ActionButton>
      </div>
      <ActionButton
        variant="secondary"
        onClick={() => {
          void application.queryClient.invalidateQueries(rooms(room));
        }}
      >
        Refresh this room
      </ActionButton>
      <output aria-label="Last readings fetch">
        {String(query.dataUpdatedAt)}
      </output>
      <ul aria-label="Decoded readings" className="grid gap-3">
        {query.data?.readings.map((reading) => (
          <ReadingCard key={reading.id} reading={reading} />
        ))}
      </ul>
      <EffectErrorDetails error={query.error ?? mutation.error} />
    </section>
  );
};

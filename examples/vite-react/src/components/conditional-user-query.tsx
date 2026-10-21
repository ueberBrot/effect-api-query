import type { User } from "@effect-api-query/contracts";
import { useQuery } from "@tanstack/react-query";
import { skipToken } from "@ueberbrot/effect-api-query";
import { useState } from "react";

import type { ViteReactApplication } from "../lib/application.ts";
import { EffectErrorDetails } from "./ui/effect-error-details.tsx";

const displayOptions = {
  select: (user: User) => `${user.name} (${user.locale})`,
  staleTime: 30_000,
};

export const ConditionalUserQuery = ({
  rpcQuery,
  users,
}: {
  readonly rpcQuery: ViteReactApplication["rpcQuery"];
  readonly users: readonly User[];
}) => {
  const [userId, setUserId] = useState("");
  const options = rpcQuery.users.get.queryOptions({
    ...displayOptions,
    input: userId === "" ? skipToken : { id: Number(userId) },
  });
  const user = useQuery(options);

  return (
    <section
      aria-label="Conditional user lookup"
      className="border-border bg-background border p-5"
    >
      <h3 className="display-heading text-text-primary text-xl font-bold">
        Choose before fetching
      </h3>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        The query waits until you choose a user. Clear the selection to pause it
        again. Reselect the same user within 30 seconds to reuse the cached
        result.
      </p>
      <label className="text-brand-300 mt-4 grid gap-2 text-sm font-bold">
        User to inspect
        <select
          className="border-border-strong bg-muted text-text-primary border p-2"
          value={userId}
          onChange={(event) => {
            setUserId(event.target.value);
          }}
        >
          <option value="">No user selected</option>
          {users.map((entry) => (
            <option key={entry.id} value={entry.id}>
              User {entry.id}: {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div aria-live="polite" className="text-text-secondary mt-4 text-sm">
        {userId === "" ? <p>Choose a user to start the query.</p> : null}
        {user.isFetching ? <p>Loading selected user…</p> : null}
        {user.data === undefined ? null : <p>Selected user: {user.data}</p>}
      </div>
      {user.error === null ? null : <EffectErrorDetails error={user.error} />}
    </section>
  );
};

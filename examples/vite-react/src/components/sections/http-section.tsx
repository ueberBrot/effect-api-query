import { directoryLimits } from "@effect-api-query/contracts";
import type { User } from "@effect-api-query/contracts";
import { ActionButton } from "@effect-api-query/shared/ui/action-button.tsx";
import { EffectErrorDetails } from "@effect-api-query/shared/ui/effect-error-details.tsx";
import {
  describeSlowQueryCancellation,
  useSlowQueryCancellation,
} from "@effect-api-query/shared/use-slow-query-cancellation.ts";
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import type { SubmitEvent } from "react";

import type { ViteReactApplication } from "../../lib/application.ts";

const HttpSelectionResult = ({
  revision,
  user,
  isFetching,
}: {
  readonly revision: string | undefined;
  readonly user: User | undefined;
  readonly isFetching: boolean;
}) => {
  if (revision === undefined) {
    return <p>HTTP user query skipped</p>;
  }
  if (user?.revision !== revision) {
    return (
      <p>{isFetching ? "Loading HTTP user…" : "HTTP user unavailable."}</p>
    );
  }
  return (
    <p>
      HTTP selected: {user.name}, locale {user.locale}
    </p>
  );
};

const HttpDirectory = ({
  application,
  users,
  onDeleted,
}: {
  readonly application: ViteReactApplication;
  readonly users: UseQueryResult<readonly User[]>;
  readonly onDeleted: (user: User) => void;
}) => {
  const { httpQuery, invalidateUsers, queryClient, userWrites } = application;
  const isSynced = users.dataUpdatedAt !== 0;
  const [cacheMessage, setCacheMessage] = useState<string>();
  const deleteUser = useMutation(userWrites.httpDelete());
  const readCache = async () => {
    const cached = await queryClient.query({
      ...httpQuery.users.list.queryOptions(),
      staleTime: Infinity,
    });
    setCacheMessage(`HTTP cached directory: ${String(cached.length)} users`);
  };
  const refresh = async () => {
    await invalidateUsers();
    setCacheMessage("HTTP and RPC user queries invalidated and refetched");
  };
  return (
    <div className="border-border bg-background space-y-4 border p-5">
      <h3 className="text-xl font-bold">HTTP directory</h3>
      <p>HTTP directory: {String(users.data?.length ?? 0)} users</p>
      {users.data !== undefined && !isSynced ? (
        <p>Refresh the directory before deleting users.</p>
      ) : null}
      <ul className="grid gap-2">
        {users.data?.map((user) => (
          <li className="flex items-center justify-between gap-3" key={user.id}>
            <span>HTTP: {user.name}</span>
            <ActionButton
              aria-label={`Delete HTTP ${user.name}`}
              disabled={!isSynced || user.id < 0 || deleteUser.isPending}
              onClick={() => {
                deleteUser.mutate(
                  {
                    params: { id: user.id },
                    query: { revision: user.revision },
                  },
                  {
                    onSuccess: () => {
                      onDeleted(user);
                    },
                  }
                );
              }}
              type="button"
              variant="danger"
            >
              Delete
            </ActionButton>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          onClick={() => {
            void readCache();
          }}
          type="button"
          variant="secondary"
        >
          Read cached HTTP directory
        </ActionButton>
        <ActionButton
          onClick={() => {
            void refresh();
          }}
          type="button"
          variant="secondary"
        >
          Invalidate HTTP user queries
        </ActionButton>
      </div>
      {cacheMessage === undefined ? null : <p>{cacheMessage}</p>}
      {deleteUser.isSuccess ? (
        <p>HTTP delete result: {String(deleteUser.data)}</p>
      ) : null}
      <EffectErrorDetails error={users.error ?? deleteUser.error} />
    </div>
  );
};

export const HttpSection = ({
  application,
}: {
  readonly application: ViteReactApplication;
}) => {
  const { httpQuery, userWrites } = application;
  const users = useQuery(httpQuery.users.list.queryOptions());
  const [selection, setSelection] = useState<Pick<User, "id" | "revision">>();
  const listedSelection = users.data?.find((user) => user.id === selection?.id);
  const selected =
    listedSelection === undefined ||
    listedSelection.revision === selection?.revision
      ? selection
      : undefined;
  const clearDeletedSelection = ({ id, revision }: User) => {
    setSelection((current) =>
      current?.id === id && current.revision === revision ? undefined : current
    );
  };
  const selectedUser = useQuery(
    httpQuery.users.get.queryOptions({
      staleTime: (query) =>
        query.state.data?.revision === selected?.revision ? 30_000 : 0,
      input:
        selected === undefined
          ? skipToken
          : { params: { id: selected.id }, query: { locale: "fr" } },
    })
  );
  const pages = useInfiniteQuery(
    httpQuery.users.page.infiniteOptions({
      initialPageParam: 0,
      input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    })
  );
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("");
  const createUser = useMutation(userWrites.httpCreate());
  const failure = useMutation(
    application.trackMutationOptions(
      httpQuery.diagnostics.fail.mutationOptions()
    )
  );
  const slowQuery = useSlowQueryCancellation(application, "http");
  const slowMessage = describeSlowQueryCancellation(slowQuery.state);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userName = name.trim();
    if (userName.length === 0) {
      return;
    }
    const userLocale = locale.trim();
    const payload =
      userLocale === ""
        ? { name: userName }
        : { name: userName, locale: userLocale };
    createUser.mutate(
      { payload },
      {
        onSuccess: () => {
          setName("");
          setLocale("");
        },
      }
    );
  };
  const loaded =
    pages.data?.pages.reduce((count, page) => count + page.users.length, 0) ??
    0;

  return (
    <section
      aria-label="HTTP API example"
      className="border-border bg-card shadow-shadow/40 space-y-5 border p-6 shadow-2xl md:col-span-2"
    >
      <h2 className="display-heading text-foreground text-3xl font-bold">
        The same directory over HTTP
      </h2>
      <p className="text-muted-foreground max-w-3xl leading-7">
        HTTP and RPC share the server directory. Each adapter has its own cache;
        mutations refresh both. Request params, query strings, and JSON payloads
        come from the HTTP contract.
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        <HttpDirectory
          application={application}
          users={users}
          onDeleted={clearDeletedSelection}
        />
        <div className="border-border bg-background space-y-4 border p-5">
          <h3 className="text-xl font-bold">HTTP request inputs</h3>
          <form className="grid gap-3" onSubmit={submit}>
            <label className="grid gap-1">
              HTTP name
              <input
                className="border-border-strong bg-muted border p-2"
                maxLength={directoryLimits.nameLength}
                required
                value={name}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
              />
            </label>
            <label className="grid gap-1">
              HTTP locale (optional)
              <input
                className="border-border-strong bg-muted border p-2"
                maxLength={directoryLimits.localeLength}
                value={locale}
                onChange={(event) => {
                  setLocale(event.currentTarget.value);
                }}
              />
            </label>
            <ActionButton disabled={createUser.isPending} type="submit">
              Add HTTP user
            </ActionButton>
          </form>
          {createUser.data === undefined ? null : (
            <p>HTTP added {createUser.data.name}</p>
          )}
          <EffectErrorDetails error={createUser.error} />
          <label className="grid gap-1">
            HTTP user details
            <select
              className="border-border-strong bg-muted border p-2"
              value={selected?.revision ?? ""}
              onChange={(event) => {
                const revision = event.currentTarget.value;
                setSelection(
                  users.data?.find((user) => user.revision === revision)
                );
              }}
            >
              <option value="">Choose an HTTP user</option>
              {users.data?.map((user) => (
                <option
                  disabled={user.id < 0}
                  key={user.id}
                  value={user.revision}
                >
                  HTTP user {user.id}: {user.name}
                </option>
              ))}
            </select>
          </label>
          <HttpSelectionResult
            isFetching={selectedUser.isFetching}
            revision={selected?.revision}
            user={selectedUser.data}
          />
          <EffectErrorDetails error={selectedUser.error} />
        </div>
        <div className="border-border bg-background space-y-4 border p-5">
          <h3 className="text-xl font-bold">HTTP pagination</h3>
          <p>
            HTTP: {String(loaded)} of {String(pages.data?.pages[0]?.total ?? 0)}{" "}
            loaded
          </p>
          <ol className="grid gap-3">
            {pages.data?.pages.map((page, index) => (
              <li
                key={pages.data.pageParams[index]}
                className="border-border-strong border p-3"
              >
                <p>
                  HTTP page {String(index + 1)}: {String(page.users.length)}{" "}
                  users
                </p>
                <p className="text-muted-foreground text-sm">
                  {page.users.map((user) => user.name).join(", ")}
                </p>
              </li>
            ))}
          </ol>
          <ActionButton
            disabled={!pages.hasNextPage || pages.isFetchingNextPage}
            onClick={() => {
              void pages.fetchNextPage();
            }}
            type="button"
          >
            Load next HTTP page
          </ActionButton>
          <EffectErrorDetails error={pages.error} />
        </div>
        <div className="border-border bg-background space-y-4 border p-5">
          <h3 className="text-xl font-bold">HTTP failures and cancellation</h3>
          <p className="text-muted-foreground text-sm">
            Cancel the browser request, then read the server&apos;s interruption
            count.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              onClick={() => {
                failure.mutate();
              }}
              type="button"
              variant="danger"
            >
              Trigger HTTP declared failure
            </ActionButton>
            <ActionButton
              disabled={!slowQuery.canStart}
              onClick={() => {
                void slowQuery.start();
              }}
              type="button"
              variant="secondary"
            >
              Start slow HTTP query
            </ActionButton>
            <ActionButton
              disabled={!slowQuery.canCancel}
              onClick={() => {
                void slowQuery.cancel();
              }}
              type="button"
              variant="secondary"
            >
              Cancel HTTP query
            </ActionButton>
          </div>
          <EffectErrorDetails error={failure.error} />
          {slowQuery.state._tag === "Failed" ? (
            <EffectErrorDetails error={slowQuery.state.error} />
          ) : null}
          {slowMessage === undefined ? null : <p>HTTP: {slowMessage}</p>}
        </div>
      </div>
    </section>
  );
};

import {
  useInfiniteQuery,
  useMutation,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ActionButton } from "../components/action-button.tsx";
import { ConditionalUserQuery } from "../components/conditional-user-query.tsx";
import { PageLayout, Panel } from "../components/page-layout.tsx";
import type { TanStackStartApplication } from "../lib/application.ts";

const PAGE_SIZE = 4;

const userPagesOptions = (rpcQuery: TanStackStartApplication["rpcQuery"]) =>
  rpcQuery.users.page.infiniteOptions({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: 0,
    input: (cursor: number) => ({ cursor, pageSize: PAGE_SIZE }),
  });

const streamedDiagnosticsOptions = (
  rpcQuery: TanStackStartApplication["rpcQuery"],
  bounded = false
) => {
  const options = {
    maxChunks: "unbounded",
    refetchOnMount: "always",
    staleTime: 0,
  } satisfies NonNullable<
    Parameters<typeof rpcQuery.diagnostics.stream.streamedOptions>[0]
  >;
  if (bounded) {
    return rpcQuery.diagnostics.stream.streamedOptions({
      ...options,
      maxChunks: 2,
    });
  }
  return rpcQuery.diagnostics.stream.streamedOptions(options);
};

const liveDiagnosticOptions = (
  rpcQuery: TanStackStartApplication["rpcQuery"]
) =>
  rpcQuery.diagnostics.stream.liveOptions({
    refetchOnMount: "always",
    staleTime: 0,
  });

const UsersPage = () => {
  const { invalidateUsers, queryClient, rpcQuery } = Route.useRouteContext();
  const users = useSuspenseQuery(rpcQuery.users.list.queryOptions());
  const [boundedHistory, setBoundedHistory] = useState(false);
  const diagnostics = useSuspenseQuery(
    streamedDiagnosticsOptions(rpcQuery, boundedHistory)
  );
  const replayStream = async (bounded: boolean) => {
    setBoundedHistory(bounded);
    try {
      await queryClient.query(streamedDiagnosticsOptions(rpcQuery, bounded));
    } catch {
      // oxlint-disable-next-line eslint/no-useless-return
      return;
    }
  };
  const liveDiagnostic = useSuspenseQuery(liveDiagnosticOptions(rpcQuery));
  const userPages = useInfiniteQuery(userPagesOptions(rpcQuery));
  const loaded =
    userPages.data?.pages.reduce(
      (count, page) => count + page.users.length,
      0
    ) ?? 0;
  const totalUsers = userPages.data?.pages[0]?.total ?? 0;
  const pageCount = userPages.data?.pages.length ?? 0;
  const remainingUsers = Math.max(0, totalUsers - loaded);
  const nextPageSize = Math.min(PAGE_SIZE, remainingUsers);
  let nextPageLabel = "All users loaded";
  if (userPages.hasNextPage) {
    nextPageLabel = `Load next ${String(nextPageSize)} users`;
  }
  if (userPages.isFetchingNextPage) {
    nextPageLabel = "Loading next page…";
  }
  const [message, setMessage] = useState<string>();
  const addGrace = useMutation(
    rpcQuery.users.create.mutationOptions({
      onSuccess: invalidateUsers,
    })
  );
  const resetUsers = useMutation(
    rpcQuery.testing.reset.mutationOptions({ onSuccess: invalidateUsers })
  );
  const reuseCachedUsers = async () => {
    const cached = await queryClient.query({
      ...rpcQuery.users.list.queryOptions(),
      staleTime: Infinity,
    });
    setMessage(`Cached directory: ${String(cached.length)} users`);
  };

  return (
    <PageLayout
      description="See how one cache holds a complete directory, a growing list of pages, a stream history, and the latest live value."
      title="Compare full queries, pages, and streams"
    >
      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <Panel title="Ordinary query: the complete directory">
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground max-w-xl text-sm leading-6">
              The loader fetched every record in one request and dehydrated the
              result for the browser.
            </p>
            <span className="border-border-strong bg-muted text-text-tertiary border px-3 py-1 text-sm font-bold">
              {String(users.data.length)} users in one response
            </span>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {users.data.map((user) => (
              <li
                className="border-border bg-background grid list-none gap-1 border p-4"
                key={user.id}
              >
                <strong>{user.name}</strong>
                <span className="text-text-subtle text-sm">
                  User {user.id}, locale {user.locale}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionButton
              onClick={() => {
                void reuseCachedUsers();
              }}
              variant="secondary"
            >
              Read cached directory
            </ActionButton>
            <ActionButton
              disabled={addGrace.isPending}
              onClick={() => {
                addGrace.mutate({ name: "Grace Hopper" });
              }}
              type="button"
            >
              Add Grace Hopper
            </ActionButton>
            <ActionButton
              onClick={() => {
                resetUsers.mutate();
              }}
              variant="secondary"
            >
              Reset directory
            </ActionButton>
          </div>
          {message === undefined ? null : (
            <p className="mt-4 text-sm">{message}</p>
          )}
          {addGrace.isSuccess ? (
            <p className="mt-4 text-sm">Added user {addGrace.data.name}.</p>
          ) : null}
          {resetUsers.isSuccess ? (
            <p className="mt-4 text-sm">Directory reset.</p>
          ) : null}
        </Panel>

        <Panel title="Infinite query: four users at a time">
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground max-w-xl text-sm leading-6">
              Each bordered block is one RPC response. A click appends the next
              page without replacing the pages already in the cache.
            </p>
            <span className="border-brand-800 bg-brand-950/80 text-brand-200 border px-3 py-1 text-sm font-bold">
              {String(loaded)} of {String(totalUsers)} loaded
            </span>
          </div>
          <ol className="mt-4 grid gap-3 p-0">
            {userPages.data?.pages.map((page, pageIndex) => (
              <li
                className="border-border bg-background list-none border p-4"
                key={userPages.data.pageParams[pageIndex]}
              >
                <p className="display-heading text-brand-300 text-sm font-bold">
                  Page {String(pageIndex + 1)}: {String(page.users.length)}{" "}
                  users
                </p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {page.users.map((user, userIndex) => (
                    <li
                      className="border-brand-800 bg-muted/80 text-text-secondary border-l-2 px-3 py-2 text-sm"
                      key={user.id}
                    >
                      <strong>{`#${String(pageIndex * PAGE_SIZE + userIndex + 1)} ${user.name}`}</strong>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ActionButton
              disabled={!userPages.hasNextPage || userPages.isFetchingNextPage}
              onClick={() => {
                void userPages.fetchNextPage();
              }}
              type="button"
            >
              {nextPageLabel}
            </ActionButton>
            <span className="text-muted-foreground text-sm font-medium">
              {String(pageCount)} {pageCount === 1 ? "page" : "pages"} in the
              cache
            </span>
          </div>
        </Panel>

        <div className="xl:col-span-2">
          <ConditionalUserQuery rpcQuery={rpcQuery} users={users.data} />
        </div>

        <section className="border-border border-l-brand-600 bg-brand-950/10 shadow-shadow/40 border border-l-2 p-6 shadow-2xl xl:col-span-2">
          <h2 className="display-heading text-foreground text-2xl font-black">
            One stream, two cache models
          </h2>
          <p className="text-muted-foreground mt-3 max-w-3xl text-sm leading-6">
            The server emits four states over time. Keep the full timeline or
            replay with room for only the newest two updates. The live query
            shows only the newest state.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <section
              aria-label="Accumulated stream history"
              className="border-border bg-background border p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="display-heading text-brand-300 text-sm font-bold">
                  Accumulated stream:{" "}
                  {boundedHistory ? "newest 2 updates" : "keeps history"}
                </p>
                <span className="border-brand-900 bg-brand-950/80 text-brand-200 border px-3 py-1 text-xs font-bold">
                  {String(diagnostics.data.length)}{" "}
                  {diagnostics.data.length === 1 ? "update" : "updates"}{" "}
                  retained
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton
                  disabled={diagnostics.isFetching}
                  onClick={() => {
                    void replayStream(false);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Replay full history
                </ActionButton>
                <ActionButton
                  disabled={diagnostics.isFetching}
                  onClick={() => {
                    void replayStream(true);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Replay newest 2
                </ActionButton>
              </div>
              <p className="text-muted-foreground mt-3 text-sm">
                {boundedHistory
                  ? "Older updates are discarded as new ones arrive."
                  : "Every update is retained."}
              </p>
              <ol className="mt-4 grid gap-2">
                {diagnostics.data.map((status, index) => (
                  <li className="flex items-center gap-3 text-sm" key={status}>
                    <span className="border-brand-900 bg-brand-950 text-brand-200 grid size-7 place-items-center border font-bold">
                      {String(index + 1)}
                    </span>
                    <span>{status}</span>
                  </li>
                ))}
              </ol>
            </section>
            <div className="border-border bg-background border p-5">
              <p className="display-heading text-brand-300 text-sm font-bold">
                Live query: latest only
              </p>
              <p className="display-heading text-foreground mt-6 text-3xl font-black">
                Current state: {liveDiagnostic.data}
              </p>
              <p className="text-text-subtle mt-2 text-sm">
                Earlier states are replaced.
              </p>
            </div>
          </div>
        </section>
      </div>
    </PageLayout>
  );
};

export const Route = createFileRoute("/")({
  component: UsersPage,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.query({
        ...context.rpcQuery.users.list.queryOptions(),
        staleTime: "static",
      }),
      context.queryClient.infiniteQuery({
        ...userPagesOptions(context.rpcQuery),
        staleTime: "static",
      }),
      context.captureSnapshot(
        context.queryClient,
        streamedDiagnosticsOptions(context.rpcQuery)
      ),
      context.captureSnapshot(
        context.queryClient,
        liveDiagnosticOptions(context.rpcQuery)
      ),
    ]);
  },
});

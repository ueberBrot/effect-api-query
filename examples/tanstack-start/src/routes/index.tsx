import { useInfiniteQuery, useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { ActionButton } from '../components/action-button.tsx'
import { ConditionalUserQuery } from '../components/conditional-user-query.tsx'
import { PageLayout, Panel } from '../components/page-layout.tsx'
import type { TanStackStartApplication } from '../lib/application.ts'
import { fetchStreamSnapshot } from '../lib/query-ssr.ts'

const PAGE_SIZE = 4

const userPagesOptions = (rpcQuery: TanStackStartApplication['rpcQuery']) =>
  rpcQuery.users.page.infiniteOptions({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: 0,
    input: (cursor: number) => ({ cursor, pageSize: PAGE_SIZE }),
  })

const streamedDiagnosticsOptions = (
  rpcQuery: TanStackStartApplication['rpcQuery'],
  bounded = false,
) =>
  rpcQuery.diagnostics.stream.streamedOptions({
    ...(bounded ? { maxChunks: 2 } : {}),
    refetchOnMount: 'always',
    staleTime: 0,
  })

const liveDiagnosticOptions = (rpcQuery: TanStackStartApplication['rpcQuery']) =>
  rpcQuery.diagnostics.stream.liveOptions({ refetchOnMount: 'always', staleTime: 0 })

export const Route = createFileRoute('/')({
  component: UsersPage,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.query({
        ...context.rpcQuery.users.list.queryOptions(),
        staleTime: 'static',
      }),
      context.queryClient.infiniteQuery({
        ...userPagesOptions(context.rpcQuery),
        staleTime: 'static',
      }),
      fetchStreamSnapshot(context.queryClient, streamedDiagnosticsOptions(context.rpcQuery)),
      fetchStreamSnapshot(context.queryClient, liveDiagnosticOptions(context.rpcQuery)),
    ])
  },
})

function UsersPage() {
  const { invalidateUsers, queryClient, rpcQuery } = Route.useRouteContext()
  const users = useSuspenseQuery(rpcQuery.users.list.queryOptions())
  const [boundedHistory, setBoundedHistory] = useState(false)
  const diagnostics = useSuspenseQuery(streamedDiagnosticsOptions(rpcQuery, boundedHistory))
  const replayStream = (bounded: boolean) => {
    setBoundedHistory(bounded)
    void queryClient.query(streamedDiagnosticsOptions(rpcQuery, bounded)).catch(() => undefined)
  }
  const liveDiagnostic = useSuspenseQuery(liveDiagnosticOptions(rpcQuery))
  const userPages = useInfiniteQuery(userPagesOptions(rpcQuery))
  const loadedUsers = userPages.data?.pages.flatMap((page) => page.users) ?? []
  const totalUsers = userPages.data?.pages[0]?.total ?? 0
  const pageCount = userPages.data?.pages.length ?? 0
  const remainingUsers = Math.max(0, totalUsers - loadedUsers.length)
  const nextPageSize = Math.min(PAGE_SIZE, remainingUsers)
  const [message, setMessage] = useState<string>()
  const addGrace = useMutation(
    rpcQuery.users.create.mutationOptions({
      onSuccess: invalidateUsers,
    }),
  )
  const resetUsers = useMutation(
    rpcQuery.testing.reset.mutationOptions({ onSuccess: invalidateUsers }),
  )
  const reuseCachedUsers = async () => {
    const cached = await queryClient.query({
      ...rpcQuery.users.list.queryOptions(),
      staleTime: Infinity,
    })
    setMessage(`Cached directory: ${String(cached.length)} users`)
  }

  return (
    <PageLayout
      description="See how one cache holds a complete directory, a growing list of pages, a stream history, and the latest live value."
      title="Compare full queries, pages, and streams"
    >
      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <Panel title="Ordinary query: the complete directory">
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xl text-sm leading-6 text-zinc-400">
              The loader fetched every record in one request and dehydrated the result for the
              browser.
            </p>
            <span className="border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm font-bold text-zinc-300">
              {String(users.data.length)} users in one response
            </span>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {users.data.map((user) => (
              <li
                className="grid list-none gap-1 border border-zinc-800 bg-black p-4"
                key={user.id}
              >
                <strong>{user.name}</strong>
                <span className="text-sm text-zinc-500">
                  User {user.id}, locale {user.locale}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionButton onClick={() => void reuseCachedUsers()} variant="secondary">
              Read cached directory
            </ActionButton>
            <ActionButton
              disabled={addGrace.isPending}
              onClick={() => addGrace.mutate({ name: 'Grace Hopper' })}
              type="button"
            >
              Add Grace Hopper
            </ActionButton>
            <ActionButton onClick={() => resetUsers.mutate(undefined)} variant="secondary">
              Reset directory
            </ActionButton>
          </div>
          {message === undefined ? null : <p className="mt-4 text-sm">{message}</p>}
          {addGrace.isSuccess ? (
            <p className="mt-4 text-sm">Added user {addGrace.data.name}.</p>
          ) : null}
          {resetUsers.isSuccess ? <p className="mt-4 text-sm">Directory reset.</p> : null}
        </Panel>

        <Panel title="Infinite query: four users at a time">
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xl text-sm leading-6 text-zinc-400">
              Each bordered block is one RPC response. A click appends the next page without
              replacing the pages already in the cache.
            </p>
            <span className="border border-violet-800 bg-violet-950/80 px-3 py-1 text-sm font-bold text-violet-200">
              {String(loadedUsers.length)} of {String(totalUsers)} loaded
            </span>
          </div>
          <ol className="mt-4 grid gap-3 p-0">
            {userPages.data?.pages.map((page, pageIndex) => (
              <li
                className="list-none border border-zinc-800 bg-black p-4"
                key={userPages.data.pageParams[pageIndex]}
              >
                <p className="display-heading text-sm font-bold text-violet-300">
                  Page {String(pageIndex + 1)}: {String(page.users.length)} users
                </p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {page.users.map((user, userIndex) => (
                    <li
                      className="border-l-2 border-violet-800 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-200"
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
              onClick={() => void userPages.fetchNextPage()}
              type="button"
            >
              {userPages.isFetchingNextPage
                ? 'Loading next page…'
                : userPages.hasNextPage
                  ? `Load next ${String(nextPageSize)} users`
                  : 'All users loaded'}
            </ActionButton>
            <span className="text-sm font-medium text-zinc-400">
              {String(pageCount)} {pageCount === 1 ? 'page' : 'pages'} in the cache
            </span>
          </div>
        </Panel>

        <div className="xl:col-span-2">
          <ConditionalUserQuery rpcQuery={rpcQuery} users={users.data} />
        </div>

        <section className="border border-l-2 border-zinc-800 border-l-violet-600 bg-violet-950/10 p-6 shadow-2xl shadow-black/40 xl:col-span-2">
          <h2 className="display-heading text-2xl font-black text-zinc-50">
            One stream, two cache models
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            The server emits four states over time. Keep the full timeline or replay with room for
            only the newest two updates. The live query shows only the newest state.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div
              aria-label="Accumulated stream history"
              role="region"
              className="border border-zinc-800 bg-black p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="display-heading text-sm font-bold text-violet-300">
                  Accumulated stream: {boundedHistory ? 'newest 2 updates' : 'keeps history'}
                </p>
                <span className="border border-violet-900 bg-violet-950/80 px-3 py-1 text-xs font-bold text-violet-200">
                  {String(diagnostics.data.length)}{' '}
                  {diagnostics.data.length === 1 ? 'update' : 'updates'} retained
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton
                  disabled={diagnostics.isFetching}
                  onClick={() => replayStream(false)}
                  type="button"
                  variant="secondary"
                >
                  Replay full history
                </ActionButton>
                <ActionButton
                  disabled={diagnostics.isFetching}
                  onClick={() => replayStream(true)}
                  type="button"
                  variant="secondary"
                >
                  Replay newest 2
                </ActionButton>
              </div>
              <p className="mt-3 text-sm text-zinc-400">
                {boundedHistory
                  ? 'Older updates are discarded as new ones arrive.'
                  : 'Every update is retained.'}
              </p>
              <ol className="mt-4 grid gap-2">
                {diagnostics.data.map((status, index) => (
                  <li className="flex items-center gap-3 text-sm" key={status}>
                    <span className="grid size-7 place-items-center border border-violet-900 bg-violet-950 font-bold text-violet-200">
                      {String(index + 1)}
                    </span>
                    <span>{status}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="border border-zinc-800 bg-black p-5">
              <p className="display-heading text-sm font-bold text-violet-300">
                Live query: latest only
              </p>
              <p className="display-heading mt-6 text-3xl font-black text-zinc-50">
                Current state: {liveDiagnostic.data}
              </p>
              <p className="mt-2 text-sm text-zinc-500">Earlier states are replaced.</p>
            </div>
          </div>
        </section>
      </div>
    </PageLayout>
  )
}

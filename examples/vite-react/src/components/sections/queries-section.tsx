import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Suspense, useState } from 'react'

import type { ViteReactApplication } from '../../lib/application.ts'
import { ConditionalUserQuery } from '../conditional-user-query.tsx'
import { ActionButton } from '../ui/action-button.tsx'
import { EffectErrorDetails } from '../ui/effect-error-details.tsx'
import { UserList } from '../users/user-list.tsx'

const PAGE_SIZE = 4

const streamedDiagnosticsOptions = (rpcQuery: ViteReactApplication['rpcQuery'], bounded: boolean) =>
  rpcQuery.diagnostics.stream.streamedOptions(bounded ? { maxChunks: 2 } : {})

const FeaturedUser = ({ application }: { readonly application: ViteReactApplication }) => {
  const featured = useSuspenseQuery(
    application.rpcQuery.users.get.queryOptions({ input: { id: 1 } }),
  )
  return <p className="text-sm text-muted-foreground">Featured: {featured.data.name}</p>
}

const InfiniteUserQueries = ({
  rpcQuery,
}: {
  readonly rpcQuery: ViteReactApplication['rpcQuery']
}) => {
  const userPages = useInfiniteQuery(
    rpcQuery.users.page.infiniteOptions({
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialPageParam: 0,
      input: (cursor: number) => ({ cursor, pageSize: PAGE_SIZE }),
    }),
  )
  const loadedUsers = userPages.data?.pages.flatMap((page) => page.users) ?? []
  const totalUsers = userPages.data?.pages[0]?.total ?? 0
  const pageCount = userPages.data?.pages.length ?? 0
  const remainingUsers = Math.max(0, totalUsers - loadedUsers.length)
  const nextPageSize = Math.min(PAGE_SIZE, remainingUsers)
  let nextPageLabel = 'All users loaded'
  if (userPages.hasNextPage) {
    nextPageLabel = `Load next ${String(nextPageSize)} users`
  }
  if (userPages.isFetchingNextPage) {
    nextPageLabel = 'Loading next page…'
  }

  return (
    <div className="border border-l-2 border-border border-l-brand-600 bg-brand-950/10 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display-heading text-xl font-bold text-text-primary">Infinite query</h3>
        <span className="border border-brand-800 bg-brand-950/80 px-3 py-1 text-sm font-bold text-brand-200">
          {String(loadedUsers.length)} of {String(totalUsers)} loaded
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Each bordered block below is one RPC response. Loading more preserves every earlier page and
        appends the next one.
      </p>
      <ol className="mt-4 grid gap-3 p-0">
        {userPages.data?.pages.map((page, pageIndex) => (
          <li
            className="list-none border border-border bg-background p-4"
            key={userPages.data.pageParams[pageIndex]}
          >
            <p className="display-heading text-sm font-bold text-brand-300">
              Page {String(pageIndex + 1)}: {String(page.users.length)} users
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {page.users.map((user, userIndex) => (
                <li
                  className="border-l-2 border-brand-800 bg-muted/80 px-3 py-2 text-sm text-text-secondary"
                  key={user.id}
                >
                  <strong>{`#${String(pageIndex * PAGE_SIZE + userIndex + 1)} ${user.name}`}</strong>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton
          disabled={!userPages.hasNextPage || userPages.isFetchingNextPage}
          onClick={() => {
            void userPages.fetchNextPage()
          }}
          type="button"
        >
          {nextPageLabel}
        </ActionButton>
        <span className="text-sm font-medium text-muted-foreground">
          {String(pageCount)} {pageCount === 1 ? 'page' : 'pages'} in the cache
        </span>
      </div>
    </div>
  )
}

export const QueriesSection = ({ application }: { readonly application: ViteReactApplication }) => {
  const { queryClient, rpcQuery } = application
  const users = useQuery(rpcQuery.users.list.queryOptions())
  const [boundedHistory, setBoundedHistory] = useState(false)
  const diagnostics = useQuery(streamedDiagnosticsOptions(rpcQuery, boundedHistory))
  const replayStream = async (bounded: boolean) => {
    setBoundedHistory(bounded)
    try {
      await queryClient.query(streamedDiagnosticsOptions(rpcQuery, bounded))
    } catch {
      // Query state retains the error for rendering.
    }
  }
  const liveDiagnostic = useQuery(rpcQuery.diagnostics.stream.liveOptions())
  const [cacheMessage, setCacheMessage] = useState<string>()
  const [invalidationMessage, setInvalidationMessage] = useState<string>()
  const invalidateUsers = async () =>
    queryClient.invalidateQueries({ queryKey: rpcQuery.users.key() })

  const reuseCachedUsers = async () => {
    const cached = await queryClient.query({
      ...rpcQuery.users.list.queryOptions(),
      staleTime: Infinity,
    })
    setCacheMessage(`Cached directory: ${String(cached?.length ?? 0)} users`)
  }

  const invalidateUserQueries = async () => {
    await invalidateUsers()
    setInvalidationMessage('Directory queries invalidated and refetched')
  }

  return (
    <section className="space-y-6 border border-border bg-card p-6 shadow-2xl shadow-shadow/40 md:col-span-2">
      <div>
        <h2 className="display-heading text-3xl font-bold tracking-tight text-foreground">
          One directory, two strategies
        </h2>
        <p className="mt-2 max-w-3xl leading-7 text-muted-foreground">
          The ordinary query downloads the full directory. The infinite query starts with four
          people and appends one clearly labeled page per click.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="border border-border bg-background p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="display-heading text-xl font-bold text-text-primary">Ordinary query</h3>
            <span className="border border-border-strong bg-muted px-3 py-1 text-sm font-bold text-text-tertiary">
              {String(users.data?.length ?? 0)} users in one response
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Every user arrives together and shares one cache entry.
          </p>
          {users.isPending ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading users…</p>
          ) : null}
          {users.error === null ? null : <EffectErrorDetails error={users.error} />}
          <div className="mt-4">
            <UserList application={application} users={users.data} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Suspense
              fallback={<p className="text-sm text-muted-foreground">Loading featured user…</p>}
            >
              <FeaturedUser application={application} />
            </Suspense>
            <ActionButton
              onClick={() => {
                void reuseCachedUsers()
              }}
              type="button"
              variant="secondary"
            >
              Read cached directory
            </ActionButton>
            <ActionButton
              onClick={() => {
                void invalidateUserQueries()
              }}
              type="button"
              variant="secondary"
            >
              Invalidate user queries
            </ActionButton>
          </div>
          {cacheMessage === undefined ? null : <p className="mt-3 text-sm">{cacheMessage}</p>}
          {invalidationMessage === undefined ? null : (
            <p className="mt-3 text-sm">{invalidationMessage}</p>
          )}
        </div>

        <ConditionalUserQuery rpcQuery={rpcQuery} users={users.data ?? []} />

        <InfiniteUserQueries rpcQuery={rpcQuery} />
      </div>

      <div className="border border-l-2 border-border border-l-brand-600 bg-brand-950/10 p-5">
        <h3 className="display-heading text-2xl font-bold text-text-primary">
          Watch the same RPC stream two ways
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Keep the full timeline or replay with room for only the newest two updates. The live query
          shows only the newest state.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section
            aria-label="Accumulated stream history"
            className="border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="display-heading text-sm font-bold text-brand-300">
                Accumulated stream: {boundedHistory ? 'newest 2 updates' : 'keeps history'}
              </p>
              <span className="border border-brand-900 bg-brand-950/80 px-3 py-1 text-xs font-bold text-brand-200">
                {String(diagnostics.data?.length ?? 0)}{' '}
                {(diagnostics.data?.length ?? 0) === 1 ? 'update' : 'updates'} retained
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton
                disabled={diagnostics.isFetching}
                onClick={() => {
                  void replayStream(false)
                }}
                type="button"
                variant="secondary"
              >
                Replay full history
              </ActionButton>
              <ActionButton
                disabled={diagnostics.isFetching}
                onClick={() => {
                  void replayStream(true)
                }}
                type="button"
                variant="secondary"
              >
                Replay newest 2
              </ActionButton>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {boundedHistory
                ? 'Older updates are discarded as new ones arrive.'
                : 'Every update is retained.'}
            </p>
            <ol className="mt-3 grid gap-2">
              {diagnostics.data?.map((status, index) => (
                <li className="flex items-center gap-3 text-sm" key={status}>
                  <span className="grid size-7 place-items-center border border-brand-900 bg-brand-950 font-bold text-brand-200">
                    {String(index + 1)}
                  </span>
                  <span>{status}</span>
                </li>
              )) ?? <li className="text-sm text-text-subtle">Waiting for the first update…</li>}
            </ol>
          </section>
          <div className="border border-border bg-background p-4">
            <p className="display-heading text-sm font-bold text-brand-300">
              Live query: latest only
            </p>
            <p className="display-heading mt-5 text-2xl font-black text-foreground">
              Current state: {liveDiagnostic.data ?? 'Waiting for an update…'}
            </p>
            <p className="mt-2 text-sm text-text-subtle">Earlier values are replaced.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

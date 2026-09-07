import { skipToken, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { type SubmitEvent, useState } from 'react'

import { ActionButton } from '../components/action-button.tsx'
import { EffectErrorDetails } from '../components/effect-error-details.tsx'
import { PageLayout } from '../components/page-layout.tsx'
import {
  describeSlowQueryCancellation,
  useSlowQueryCancellation,
} from '../hooks/use-slow-query-cancellation.ts'
import type { TanStackStartApplication } from '../lib/application.ts'

const userPagesOptions = (httpQuery: TanStackStartApplication['httpQuery']) =>
  httpQuery.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })

export const Route = createFileRoute('/http')({
  component: HttpPage,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.query({
        ...context.httpQuery.users.list.queryOptions(),
        staleTime: 'static',
      }),
      context.queryClient.infiniteQuery({
        ...userPagesOptions(context.httpQuery),
        staleTime: 'static',
      }),
    ])
  },
})

function HttpPage() {
  const application = Route.useRouteContext()
  const { httpQuery, invalidateUsers, queryClient } = application
  const users = useQuery(httpQuery.users.list.queryOptions())
  const [selectedId, setSelectedId] = useState<number>()
  const selectedUser = useQuery(
    httpQuery.users.get.queryOptions({
      staleTime: 30_000,
      input:
        selectedId === undefined
          ? skipToken
          : { params: { id: selectedId }, query: { locale: 'fr' } },
    }),
  )
  const pages = useInfiniteQuery(userPagesOptions(httpQuery))
  const [name, setName] = useState('')
  const [locale, setLocale] = useState('')
  const [cacheMessage, setCacheMessage] = useState<string>()
  const createUser = useMutation(
    httpQuery.users.create.mutationOptions({ onSuccess: invalidateUsers }),
  )
  const deleteUser = useMutation(
    httpQuery.users.delete.mutationOptions({
      onSuccess: async (_, input) => {
        if (selectedId === input.params.id) setSelectedId(undefined)
        await invalidateUsers()
      },
    }),
  )
  const failure = useMutation(httpQuery.diagnostics.fail.mutationOptions())
  const slowQuery = useSlowQueryCancellation(application, 'http')
  const slowMessage = describeSlowQueryCancellation(slowQuery.state)
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const userName = name.trim()
    if (userName.length === 0) return
    createUser.mutate(
      { payload: { name: userName, ...(locale.trim() === '' ? {} : { locale: locale.trim() }) } },
      {
        onSuccess: () => {
          setName('')
          setLocale('')
        },
      },
    )
  }
  const readCache = async () => {
    const cached = await queryClient.query({
      ...httpQuery.users.list.queryOptions(),
      staleTime: Infinity,
    })
    setCacheMessage(`HTTP cached directory: ${String(cached.length)} users`)
  }
  const refresh = async () => {
    await invalidateUsers()
    setCacheMessage('HTTP and RPC user queries invalidated and refetched')
  }
  const loaded = pages.data?.pages.flatMap((page) => page.users) ?? []

  return (
    <PageLayout
      title="HTTP users"
      description="The loader prefetched the directory and first page for the browser. HTTP and RPC share the server directory; mutations refresh both caches."
    >
      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <div className="space-y-4 border border-zinc-800 bg-black p-5">
          <h2 className="text-xl font-bold">HTTP directory</h2>
          <p>HTTP directory: {String(users.data?.length ?? 0)} users</p>
          <ul className="grid gap-2">
            {users.data?.map((user) => (
              <li className="flex items-center justify-between gap-3" key={user.id}>
                <span>HTTP: {user.name}</span>
                <ActionButton
                  aria-label={`Delete HTTP ${user.name}`}
                  disabled={deleteUser.isPending}
                  onClick={() => deleteUser.mutate({ params: { id: user.id } })}
                  type="button"
                  variant="danger"
                >
                  Delete
                </ActionButton>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={() => void readCache()} type="button" variant="secondary">
              Read cached HTTP directory
            </ActionButton>
            <ActionButton onClick={() => void refresh()} type="button" variant="secondary">
              Invalidate HTTP user queries
            </ActionButton>
          </div>
          {cacheMessage === undefined ? null : <p>{cacheMessage}</p>}
          {deleteUser.isSuccess ? <p>HTTP delete result: {String(deleteUser.data)}</p> : null}
          <EffectErrorDetails error={users.error ?? deleteUser.error} />
        </div>
        <div className="space-y-4 border border-zinc-800 bg-black p-5">
          <h2 className="text-xl font-bold">HTTP request inputs</h2>
          <form className="grid gap-3" onSubmit={submit}>
            <label className="grid gap-1">
              HTTP name
              <input
                className="border border-zinc-700 bg-zinc-900 p-2"
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label className="grid gap-1">
              HTTP locale (optional)
              <input
                className="border border-zinc-700 bg-zinc-900 p-2"
                value={locale}
                onChange={(event) => setLocale(event.currentTarget.value)}
              />
            </label>
            <ActionButton disabled={createUser.isPending} type="submit">
              Add HTTP user
            </ActionButton>
          </form>
          {createUser.data === undefined ? null : <p>HTTP added {createUser.data.name}</p>}
          <EffectErrorDetails error={createUser.error} />
          <label className="grid gap-1">
            HTTP user details
            <select
              className="border border-zinc-700 bg-zinc-900 p-2"
              value={selectedId ?? ''}
              onChange={(event) =>
                setSelectedId(
                  event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value),
                )
              }
            >
              <option value="">Choose an HTTP user</option>
              {users.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  HTTP user {user.id}: {user.name}
                </option>
              ))}
            </select>
          </label>
          {selectedId === undefined ? (
            <p>HTTP user query skipped</p>
          ) : selectedUser.data === undefined ? (
            <p>Loading HTTP user…</p>
          ) : (
            <p>
              HTTP selected: {selectedUser.data.name}, locale {selectedUser.data.locale}
            </p>
          )}
          <EffectErrorDetails error={selectedUser.error} />
        </div>
        <div className="space-y-4 border border-zinc-800 bg-black p-5">
          <h2 className="text-xl font-bold">HTTP pagination</h2>
          <p>
            HTTP: {String(loaded.length)} of {String(pages.data?.pages[0]?.total ?? 0)} loaded
          </p>
          <ol className="grid gap-3">
            {pages.data?.pages.map((page, index) => (
              <li key={pages.data.pageParams[index]} className="border border-zinc-700 p-3">
                <p>
                  HTTP page {String(index + 1)}: {String(page.users.length)} users
                </p>
                <p className="text-sm text-zinc-400">
                  {page.users.map((user) => user.name).join(', ')}
                </p>
              </li>
            ))}
          </ol>
          <ActionButton
            disabled={!pages.hasNextPage || pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
            type="button"
          >
            Load next HTTP page
          </ActionButton>
          <EffectErrorDetails error={pages.error} />
        </div>
        <div className="space-y-4 border border-zinc-800 bg-black p-5">
          <h2 className="text-xl font-bold">HTTP failures and cancellation</h2>
          <p className="text-sm text-zinc-400">
            Cancel the browser request, then read the server's interruption count.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={() => failure.mutate(undefined)} type="button" variant="danger">
              Trigger HTTP declared failure
            </ActionButton>
            <ActionButton
              disabled={!slowQuery.canStart}
              onClick={() => void slowQuery.start()}
              type="button"
              variant="secondary"
            >
              Start slow HTTP query
            </ActionButton>
            <ActionButton
              disabled={!slowQuery.canCancel}
              onClick={() => void slowQuery.cancel()}
              type="button"
              variant="secondary"
            >
              Cancel HTTP query
            </ActionButton>
          </div>
          <EffectErrorDetails error={failure.error} />
          {slowQuery.state._tag === 'Failed' ? (
            <EffectErrorDetails error={slowQuery.state.error} />
          ) : null}
          {slowMessage === undefined ? null : <p>HTTP: {slowMessage}</p>}
        </div>
      </div>
    </PageLayout>
  )
}

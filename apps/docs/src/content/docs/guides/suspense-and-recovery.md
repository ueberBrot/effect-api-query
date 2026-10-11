---
title: Suspense and Error Recovery
description: Reset failed Suspense queries, preserve cached data, and start independent reads together.
---

Use TanStack's native Suspense hooks inside an existing `QueryClientProvider`, such as the
[React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client).
`useSuspenseQuery` provides defined data after its loading boundary resolves. An initial failure
reaches the nearest React error boundary after retries finish.

TanStack documents that cancellation does not work with `useSuspenseQuery`,
`useSuspenseQueries`, or `useSuspenseInfiniteQuery`. Choose `useQuery` or `useInfiniteQuery`
when your screen depends on cancellation, including stopping open stream work when observation
ends. Generated signal forwarding does not remove this native hook limitation.
See [TanStack query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation#limitations).

## Define a displayable failure

This complete recipe uses a ready client for the following RPC contract. The application chooses
which declared messages are suitable for users. Error boundaries receive `unknown`; recognize the
execution wrapper and validate its Cause failure with Schema before reading a domain message.
Transport failures, defects, and unexpected errors use a generic fallback.

```tsx
import {
  QueryErrorResetBoundary,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Cause, Result, Schema } from 'effect'
import { createRpcQueryUtils, isEffectRpcQueryError } from 'effect-api-query'
import type { InferQueryData, InferQueryError } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'
import { Component, Suspense } from 'react'
import type { ReactNode } from 'react'

export class UserUnavailable extends Schema.TaggedError<UserUnavailable>()('UserUnavailable', {
  message: Schema.String,
}) {}

export const suspenseGroup = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    error: UserUnavailable,
  }),
)

export const makeSuspenseQueries = <E,>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof suspenseGroup>, E>,
) =>
  createRpcQueryUtils<typeof suspenseGroup, readonly ['suspense-users'], E>(suspenseGroup, {
    client,
    keyPrefix: ['suspense-users'],
  })

export type Queries<E> = ReturnType<typeof makeSuspenseQueries<E>>

export const failureMessage = (error: unknown): string => {
  if (isEffectRpcQueryError(error)) {
    const failure = Cause.findError(error.cause)
    if (
      error.cause.reasons.length === 1 &&
      Result.isSuccess(failure) &&
      Schema.is(UserUnavailable)(failure.success)
    ) {
      return failure.success.message
    }
  }
  return 'The request failed. Please try again.'
}
```

## Reset both boundaries

React owns the error boundary below. `QueryErrorResetBoundary` supplies its `onReset` callback.
The retry button first resets TanStack's failed-query boundary, then clears React's error state
so the component can mount and fetch again. This uses React's built-in Component class and
requires no additional error-boundary package.

```tsx
interface BoundaryProps {
  readonly children: ReactNode
  readonly onReset: () => void
}

interface BoundaryState {
  readonly failed: boolean
  readonly error: unknown
}

class RequestErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, error: undefined }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error }
  }

  reset = () => {
    this.props.onReset()
    this.setState({ failed: false, error: undefined })
  }

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert">
          <p>{failureMessage(this.state.error)}</p>
          <button type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

## Preserve data after a failed refresh

Use both boundaries around the component. This example disables automatic retries so the user
can choose when to retry. It retains native Suspense behavior: a failed initial load reaches the
boundary; a failed background refetch keeps cached data visible and displays an inline error.
The Refresh button retries that background request.

```tsx
const UserDetails = <E,>({ rpc }: { readonly rpc: Queries<E> }) => {
  const user = useSuspenseQuery(
    rpc.users.get.queryOptions({ input: { id: 1 }, retry: false, staleTime: 30_000 }),
  )
  return (
    <>
      <h2>{user.data.name}</h2>
      {user.error !== null && !user.isFetching ? (
        <p role="alert">{failureMessage(user.error)}</p>
      ) : null}
      <button type="button" onClick={() => void user.refetch()} disabled={user.isFetching}>
        Refresh
      </button>
    </>
  )
}

export const UserScreen = <E,>({ rpc }: { readonly rpc: Queries<E> }) => (
  <QueryErrorResetBoundary>
    {({ reset }) => (
      <RequestErrorBoundary onReset={reset}>
        <Suspense fallback={<p>Loading user…</p>}>
          <UserDetails rpc={rpc} />
        </Suspense>
      </RequestErrorBoundary>
    )}
  </QueryErrorResetBoundary>
)
```

Suspense throws query failures by default only when cached data is absent. If your application
must route failed refetches to the error boundary too, throw the observer error from the component
after fetching stops. Handle intentional `null` query data explicitly when using a void contract.
See [TanStack Suspense recovery](https://tanstack.com/query/latest/docs/framework/react/guides/suspense#resetting-error-boundaries).

## Start independent reads together

Sequential `useSuspenseQuery` calls in one component can create a waterfall: the first hook
suspends before the later hook runs. Pass independent requests to `useSuspenseQueries` instead.
With generated options, explicit query descriptors retain the data and error types through
TanStack's parallel-hook overloads. Derive these descriptors from the leaf so changes to its
contract update every consumer.

```tsx
export const TwoUsers = <E,>({ rpc }: { readonly rpc: Queries<E> }) => {
  type UserQuery = {
    queryFnData: InferQueryData<typeof rpc.users.get>
    error: InferQueryError<typeof rpc.users.get>
  }
  const [ada, grace] = useSuspenseQueries<[UserQuery, UserQuery]>({
    queries: [
      rpc.users.get.queryOptions({ input: { id: 1 }, retry: false, staleTime: 30_000 }),
      rpc.users.get.queryOptions({ input: { id: 2 }, retry: false, staleTime: 30_000 }),
    ],
  })
  return (
    <p>
      {ada.data.name} and {grace.data.name}
    </p>
  )
}
```

Render `TwoUsers` inside the same reset and Suspense boundaries. Both reads start together.
Choose a `staleTime` long enough that an earlier completed query remains fresh while the other
finishes; otherwise mounting after Suspense resolves can cause an immediate refetch.

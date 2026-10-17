import {
  QueryErrorResetBoundary,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createRpcQueryUtils, isEffectRpcQueryError } from '@ueberbrot/effect-api-query'
import type { InferQueryData, InferQueryError } from '@ueberbrot/effect-api-query'
import { Cause, Result, Schema } from 'effect'
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

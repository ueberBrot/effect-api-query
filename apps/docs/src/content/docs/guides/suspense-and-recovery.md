---
title: Suspense and Error Recovery
description: Reset failed Suspense queries, preserve cached data, and start independent reads together.
---

Mount native Suspense hooks under a `QueryClientProvider`, as in the [React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client). `useSuspenseQuery` returns defined data once loading succeeds. If the first read fails after retries, the nearest React error boundary handles it.

Choose `useQuery` or `useInfiniteQuery` when your screen needs cancellation. TanStack documents that its three Suspense hooks do not support query cancellation. This matters for streams that must stop when the last observer leaves. See [TanStack query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation#limitations).

## Define a displayable failure

Acquire a client for this RPC contract. Error boundaries receive `unknown`. Recognize the execution error and use Schema to validate the declared failure before showing its message. Use a generic message for transport failures, defects, and unexpected errors.

```tsx
import {
  QueryErrorResetBoundary,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  createRpcQueryUtils,
  isEffectRpcQueryError,
} from "@ueberbrot/effect-api-query";
import { Cause, Result, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
import { Component, Suspense } from "react";
import type { ReactNode } from "react";

export class UserUnavailable extends Schema.TaggedError<
  UserUnavailable,
  { readonly brand: unique symbol }
>()("UserUnavailable", {
  message: Schema.String,
}) {}

export const suspenseGroup = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    error: UserUnavailable,
  })
);

export const makeSuspenseQueries = <E,>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof suspenseGroup>, E>
) =>
  createRpcQueryUtils<typeof suspenseGroup, readonly ["suspense-users"], E>(
    suspenseGroup,
    {
      client,
      keyPrefix: ["suspense-users"],
    }
  );

export type Queries<E> = ReturnType<typeof makeSuspenseQueries<E>>;

export const failureMessage = (error: unknown): string => {
  if (isEffectRpcQueryError(error)) {
    const failure = Cause.findError(error.cause);
    if (
      error.cause.reasons.length === 1 &&
      Result.isSuccess(failure) &&
      Schema.is(UserUnavailable)(failure.success)
    ) {
      return failure.success.message;
    }
  }
  return "The request failed. Please try again.";
};
```

## Reset both boundaries

Connect `QueryErrorResetBoundary` to the React error boundary's `onReset`. The retry button resets Query's error state, then clears React's error state. The component can mount and fetch again.

```tsx
interface BoundaryProps {
  readonly children: ReactNode;
  readonly onReset: () => void;
}

interface BoundaryState {
  readonly failed: boolean;
  readonly error: unknown;
}

class RequestErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  reset = () => {
    this.props.onReset();
    this.setState({ failed: false, error: undefined });
  };

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert">
          <p>{failureMessage(this.state.error)}</p>
          <button type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

## Preserve data after a failed refresh

Wrap the component in both boundaries. This example disables automatic retries. An initial failure goes to the error boundary. A failed background refetch leaves cached data visible and shows an inline error. The Refresh button runs another refetch.

```tsx
const UserDetails = <E,>({ rpc }: { readonly rpc: Queries<E> }) => {
  const user = useSuspenseQuery(
    rpc.users.get.queryOptions({
      input: { id: 1 },
      retry: false,
      staleTime: 30_000,
    })
  );
  return (
    <>
      <h2>{user.data.name}</h2>
      {user.error !== null && !user.isFetching ? (
        <p role="alert">{failureMessage(user.error)}</p>
      ) : null}
      <button
        type="button"
        onClick={() => void user.refetch()}
        disabled={user.isFetching}
      >
        Refresh
      </button>
    </>
  );
};

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
);
```

By default, Suspense throws a query failure if the cache has no data. To show a failed refetch at the boundary as well, throw the observer error after fetching stops. Handle a successful `null` explicitly for void queries. See [TanStack Suspense recovery](https://tanstack.com/query/latest/docs/framework/react/guides/suspense#resetting-error-boundaries).

## Start independent reads together

The first `useSuspenseQuery` can suspend before the next hook runs. For independent reads, pass both sets of options to `useSuspenseQueries`.

```tsx
export const TwoUsers = <E,>({ rpc }: { readonly rpc: Queries<E> }) => {
  const [ada, grace] = useSuspenseQueries({
    queries: [
      rpc.users.get.queryOptions({
        input: { id: 1 },
        retry: false,
        staleTime: 30_000,
      }),
      rpc.users.get.queryOptions({
        input: { id: 2 },
        retry: false,
        staleTime: 30_000,
      }),
    ],
  });
  return (
    <p>
      {ada.data.name} and {grace.data.name}
    </p>
  );
};
```

Render `TwoUsers` under the same reset and Suspense boundaries. Keep the earlier result fresh with `staleTime` so mounting after both reads finish does not immediately refetch it.

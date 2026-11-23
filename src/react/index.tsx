"use client";

import type { QueryClient } from "@tanstack/query-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

import type { QueryOwner } from "../core/query-owner";

const missingQueryOwner = Symbol("missingQueryOwner");
const missingQueryUtils = Symbol("missingQueryUtils");

const queryClientTokens = new WeakMap<QueryClient, number>();
let nextQueryClientToken = 1;

const getQueryClientKey = (client: QueryClient): number => {
  const existing = queryClientTokens.get(client);
  if (existing !== undefined) {
    return existing;
  }
  const token = nextQueryClientToken;
  nextQueryClientToken += 1;
  queryClientTokens.set(client, token);
  return token;
};

const QueryOwnerContext = createContext<
  QueryOwner<unknown> | typeof missingQueryOwner
>(missingQueryOwner);
QueryOwnerContext.displayName = "QueryOwnerContext";

/**
 * Props accepted by {@link QueryOwnerProvider}.
 */
export interface QueryOwnerProviderProps {
  /** The caller-owned query owner to expose to descendants. */
  readonly owner: QueryOwner<unknown>;
  /**
   * Whether to render a `QueryClient`-keyed `<QueryClientProvider>` for `owner.queryClient`.
   * Set to `false` when an outer host (such as TanStack Start) already provides the `QueryClient`.
   * @default true
   */
  readonly provideQueryClient?: boolean;
  /** Descendant elements that read the query owner or query cache. */
  readonly children?: ReactNode;
}

/**
 * Props accepted by the `Provider` returned by {@link createQueryUtilsContext}.
 * Accepts either a `QueryOwner<Utils>` or a plain `utils` value with an optional `QueryClient`.
 */
export type QueryUtilsProviderProps<Utils> =
  | {
      /** Caller-owned query owner whose `resources` and `queryClient` are provided to descendants. */
      readonly owner: QueryOwner<Utils>;
      /**
       * Whether to render a `QueryClient`-keyed `<QueryClientProvider>` for `owner.queryClient`.
       * Set to `false` when an outer host already provides the `QueryClient`.
       * @default true
       */
      readonly provideQueryClient?: boolean;
      /** Descendant elements that read the utility tree, query owner, or query cache. */
      readonly children?: ReactNode;
      readonly utils?: never;
      readonly client?: never;
    }
  | {
      /** Utility tree or application resource bundle provided to `useQueryUtils()`. */
      readonly utils: Utils;
      /** Optional `QueryClient` to provide via a keyed `<QueryClientProvider>`. */
      readonly client?: QueryClient;
      /** Descendant elements that read the utility tree or query cache. */
      readonly children?: ReactNode;
      readonly owner?: never;
      readonly provideQueryClient?: never;
    };

/**
 * Typed React context pair returned by {@link createQueryUtilsContext}.
 */
export interface QueryUtilsContext<Utils> {
  /** Provides the utility tree (and optional `QueryOwner` / keyed `QueryClientProvider`) to descendants. */
  readonly Provider: (props: QueryUtilsProviderProps<Utils>) => ReactElement;
  /** Reads the utility tree from the nearest matching `Provider`. */
  readonly useQueryUtils: () => Utils;
}

/**
 * Lifecycle-neutral provider that exposes a caller-owned `QueryOwner` via React context
 * and optionally renders a `QueryClient`-keyed `<QueryClientProvider>` so swapping owners
 * remounts downstream observers onto the replacement cache.
 */
export const QueryOwnerProvider = ({
  children,
  owner,
  provideQueryClient = true,
}: QueryOwnerProviderProps): ReactElement => {
  const content = provideQueryClient ? (
    <QueryClientProvider
      client={owner.queryClient}
      key={getQueryClientKey(owner.queryClient)}
    >
      {children}
    </QueryClientProvider>
  ) : (
    children
  );

  return (
    <QueryOwnerContext.Provider value={owner}>
      {content}
    </QueryOwnerContext.Provider>
  );
};

/**
 * Reads the current `QueryOwner` from the nearest {@link QueryOwnerProvider}
 * or a query utils `Provider` given an `owner`.
 * @throws {Error} When called outside a `QueryOwnerProvider` or owner-backed utils `Provider`.
 */
export const useQueryOwner = (): QueryOwner<unknown> => {
  const owner = useContext(QueryOwnerContext);
  if (owner === missingQueryOwner) {
    throw new Error(
      "useQueryOwner must be used within a QueryOwnerProvider or a query utils Provider given an owner."
    );
  }
  return owner;
};

/**
 * Creates a typed React context pair (`Provider` and `useQueryUtils`) for a generated utility tree
 * or application resource bundle without wrapping native `@tanstack/react-query` hooks.
 */
export const createQueryUtilsContext = <Utils,>(options?: {
  readonly displayName?: string;
}): QueryUtilsContext<Utils> => {
  const displayName = options?.displayName;
  const UtilsContext = createContext<Utils | typeof missingQueryUtils>(
    missingQueryUtils
  );
  if (displayName !== undefined) {
    UtilsContext.displayName = displayName;
  }

  const Provider = (props: QueryUtilsProviderProps<Utils>): ReactElement => {
    if ("owner" in props && props.owner !== undefined) {
      return (
        <QueryOwnerProvider
          owner={props.owner}
          provideQueryClient={props.provideQueryClient ?? true}
        >
          <UtilsContext.Provider value={props.owner.resources}>
            {props.children}
          </UtilsContext.Provider>
        </QueryOwnerProvider>
      );
    }

    const content =
      props.client === undefined ? (
        props.children
      ) : (
        <QueryClientProvider
          client={props.client}
          key={getQueryClientKey(props.client)}
        >
          {props.children}
        </QueryClientProvider>
      );

    return (
      <UtilsContext.Provider value={props.utils}>
        {content}
      </UtilsContext.Provider>
    );
  };

  if (displayName !== undefined) {
    Provider.displayName = `${displayName}.Provider`;
  }

  const useQueryUtils = (): Utils => {
    const value = useContext(UtilsContext);
    if (value === missingQueryUtils) {
      const target =
        displayName === undefined ? "its Provider" : `${displayName}.Provider`;
      throw new Error(`useQueryUtils must be used within ${target}.`);
    }
    return value;
  };

  return {
    Provider,
    useQueryUtils,
  };
};

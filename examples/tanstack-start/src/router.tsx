import { startOperationSession } from "@effect-api-query/shared/operation-session.ts";
import { createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import {
  ErrorPage,
  NotFoundPage,
  PendingPage,
} from "./components/router-status.tsx";
import {
  reportCleanupFailure,
  startTanStackStartApplication,
} from "./lib/application.ts";
import type { TanStackStartApplication } from "./lib/application.ts";
import { onPermanentPageHide } from "./lib/pagehide.ts";
import { setupQuerySsr } from "./lib/query-ssr.ts";
import { startRequestApplication } from "./lib/server-host.ts";
import type { SnapshotPreparation } from "./lib/snapshot-preparation.ts";
import { routeTree } from "./routeTree.gen.ts";

export interface RouterOptions {
  readonly history?: RouterHistory;
  readonly preparation?: SnapshotPreparation;
  readonly isServer?: boolean;
  readonly scrollRestoration?: boolean;
}

export type CreateTanStackStartRouterOptions = RouterOptions &
  (
    | {
        readonly application: TanStackStartApplication;
        readonly rpcUrl?: never;
      }
    | { readonly application?: never; readonly rpcUrl: string }
  );

const registerBrowserDisposal = (
  application: TanStackStartApplication
): void => {
  if (typeof window === "undefined") {
    return;
  }
  onPermanentPageHide(() => {
    void reportCleanupFailure(application.dispose());
  });
};

export const createTanStackStartRouter = async (
  options: CreateTanStackStartRouterOptions
) => {
  const {
    history,
    isServer = typeof document === "undefined",
    scrollRestoration = true,
  } = options;
  const application =
    options.application ??
    (await startTanStackStartApplication({ rpcUrl: options.rpcUrl }));
  const navigation: {
    -readonly [Key in keyof RouterOptions]: RouterOptions[Key];
  } = {};
  if (history !== undefined) {
    navigation.history = history;
  }
  const router = createRouter({
    context: { ...application, isServer },
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
    defaultPendingComponent: PendingPage,
    defaultPendingMs: 150,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    ...navigation,
    isServer,
    routeTree,
    scrollRestoration,
  });

  setupQuerySsr(router, application, options.preparation);

  if (router.isServer) {
    router.serverSsrLifecycle = {
      ...router.serverSsrLifecycle,
      onServerSsrAttach: [
        ...(router.serverSsrLifecycle?.onServerSsrAttach ?? []),
        (serverSsr) => {
          serverSsr.onCleanup(() => {
            void reportCleanupFailure(application.dispose());
          });
        },
      ],
    };
  } else {
    registerBrowserDisposal(application);
  }

  return router;
};

const startApplication = createIsomorphicFn()
  .server(async () => await startRequestApplication(getRequest()))
  .client(async () => {
    const sessionFetch = await startOperationSession("/rpc");
    return await startTanStackStartApplication({
      rpcUrl: "/rpc",
      fetch: sessionFetch,
    });
  });

export const getRouter = async () =>
  await createTanStackStartRouter({ application: await startApplication() });

declare module "@tanstack/react-router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>;
  }
}

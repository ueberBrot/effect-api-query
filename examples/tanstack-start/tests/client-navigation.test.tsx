// @vitest-environment jsdom

import { startExampleRpcServer } from "@effect-api-query/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { TanStackStartApplication } from "../src/lib/application.ts";
import { createTanStackStartRouter } from "../src/router.tsx";

describe("TanStack Start client navigation", () => {
  let browserApplication: TanStackStartApplication | undefined;
  let serverScope: Scope.Closeable | undefined;

  beforeEach(async () => {
    window.scrollTo = () => {};
    serverScope = await Effect.runPromise(Scope.make());
  });

  afterEach(async () => {
    cleanup();
    await browserApplication?.dispose();
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void));
    }
  });

  it("renders the loader failure and the default 404", async () => {
    if (serverScope === undefined) {
      throw new Error("Server scope was not initialized");
    }
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(serverScope))
    );
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: ["/failure"] }),
      rpcUrl: server.rpcUrl,
      scrollRestoration: false,
    });
    browserApplication = router.options.context;

    await router.load();
    render(<RouterProvider router={router} />);

    const failure = await screen.findByRole("alert");
    expect(failure.textContent).toContain("DiagnosticFailure");

    await act(async () => {
      router.history.push("/missing");
      await router.load();
    });
    await expect(
      screen.findByRole("heading", { name: "Page not found" })
    ).resolves.toBeDefined();
  });

  it("reloads the home loader while both stream views remain mounted", async () => {
    if (serverScope === undefined) {
      throw new Error("Server scope was not initialized");
    }
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(serverScope))
    );
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      rpcUrl: server.rpcUrl,
      scrollRestoration: false,
    });
    browserApplication = router.options.context;
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText(/^Current state:/u, {}, { timeout: 5000 });

    await act(async () => {
      await router.invalidate({ sync: true });
    });

    expect(screen.queryByRole("heading", { name: "Route failed" })).toBeNull();
    expect(screen.getByText(/^Current state:/u)).toBeDefined();
  });
});

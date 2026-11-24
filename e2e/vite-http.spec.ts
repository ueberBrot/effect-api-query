import { expect } from "@playwright/test";
import type { Request } from "@playwright/test";
import { Deferred, Effect } from "effect";

import {
  enableDemoWrites,
  isHttpRequest,
  exampleTest as test,
  prepareExampleApplication,
  recordsRpc,
} from "./example-application.ts";

const makeGate = () => {
  const gate = Deferred.makeUnsafe<boolean>();
  return {
    promise: Effect.runPromise(Deferred.await(gate)),
    resolve: () => Deferred.doneUnsafe(gate, Effect.succeed(true)),
  };
};

test.describe("Vite React HTTP API example", () => {
  test.beforeEach(async ({ exampleUrl, page }) => {
    await prepareExampleApplication(page, exampleUrl);
  });

  test("reuses the HTTP directory cache and skips an unselected user query", async ({
    page,
  }) => {
    const http = page.getByRole("region", { name: "HTTP API example" });
    let listRequests = 0;
    let lookupRequests = 0;
    page.on("request", (request) => {
      if (isHttpRequest(request, "GET", "/users")) {
        listRequests += 1;
      }
      if (
        request.method() === "GET" &&
        /\/api\/users\/\d+$/u.test(new URL(request.url()).pathname)
      ) {
        lookupRequests += 1;
      }
    });
    await page.reload();
    await expect(
      http.getByText("HTTP: Ada Lovelace", { exact: true })
    ).toBeVisible();
    await expect(http.getByText("HTTP user query skipped")).toBeVisible();
    listRequests = 0;
    await http
      .getByRole("button", { name: "Read cached HTTP directory" })
      .click();
    await expect(
      http.getByText("HTTP cached directory: 12 users")
    ).toBeVisible();
    expect(listRequests).toBe(0);
    expect(lookupRequests).toBe(0);

    const selection = http.getByLabel("HTTP user details");
    const lookup = page.waitForRequest((request) =>
      isHttpRequest(request, "GET", "/users/2")
    );
    await selection.selectOption("2");
    const lookupRequest = await lookup;
    expect(new URL(lookupRequest.url()).searchParams.get("locale")).toBe("fr");
    await expect(
      http.getByText("HTTP selected: Edsger Dijkstra, locale fr")
    ).toBeVisible();
    expect(lookupRequests).toBe(1);
    await selection.selectOption("");
    await expect(http.getByText("HTTP user query skipped")).toBeVisible();
    await expect(
      http.getByText("HTTP selected: Edsger Dijkstra, locale fr")
    ).toHaveCount(0);
    await selection.selectOption("2");
    await expect(
      http.getByText("HTTP selected: Edsger Dijkstra, locale fr")
    ).toBeVisible();
    expect(lookupRequests).toBe(1);
  });

  test("shares mutations across adapters and decodes an HTTP no-content deletion", async ({
    page,
    writeToken,
  }) => {
    await enableDemoWrites(page, writeToken);
    const http = page.getByRole("region", { name: "HTTP API example" });
    await expect(
      http.getByText("HTTP: Ada Lovelace", { exact: true })
    ).toBeVisible();
    await http.getByLabel("HTTP name", { exact: true }).fill("HTTP pioneer");
    await http
      .getByRole("button", { name: "Add HTTP user", exact: true })
      .click();
    await expect(
      http.getByText("HTTP added HTTP pioneer", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("HTTP pioneer", { exact: true })).toBeVisible();
    await expect(
      http.getByText("HTTP: HTTP pioneer", { exact: true })
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Delete HTTP pioneer", exact: true })
      .click();
    await expect(page.getByText("HTTP pioneer", { exact: true })).toHaveCount(
      0
    );
    await expect(
      http.getByText("HTTP: HTTP pioneer", { exact: true })
    ).toHaveCount(0);

    await page.getByLabel("Name", { exact: true }).fill("RPC pioneer");
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    await expect(page.getByText("RPC pioneer", { exact: true })).toBeVisible();
    await expect(
      http.getByText("HTTP: RPC pioneer", { exact: true })
    ).toBeVisible();

    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        /\/api\/users\/\d+$/u.test(new URL(response.url()).pathname)
    );
    await http
      .getByRole("button", { name: "Delete HTTP RPC pioneer", exact: true })
      .click();
    const deletionResponse = await deletion;
    expect(deletionResponse.status()).toBe(204);
    await expect(http.getByText("HTTP delete result: undefined")).toBeVisible();
    await expect(page.getByText("RPC pioneer", { exact: true })).toHaveCount(0);
    await expect(
      http.getByText("HTTP: RPC pioneer", { exact: true })
    ).toHaveCount(0);

    const refreshedHttp = page.waitForResponse(
      (response) =>
        response.ok() && isHttpRequest(response.request(), "GET", "/users")
    );
    const refreshedRpc = page.waitForResponse(
      (response) =>
        response.ok() && recordsRpc(response.request().postData(), "users.list")
    );
    await http
      .getByRole("button", { name: "Invalidate HTTP user queries" })
      .click();
    await Promise.all([refreshedHttp, refreshedRpc]);
    await expect(
      http.getByText("HTTP and RPC user queries invalidated and refetched")
    ).toBeVisible();
  });

  test("keeps a newer HTTP selection when the previous user's deletion settles", async ({
    page,
    writeToken,
  }) => {
    await enableDemoWrites(page, writeToken);
    const http = page.getByRole("region", { name: "HTTP API example" });
    const selection = http.getByLabel("HTTP user details");
    await selection.selectOption("1");
    await expect(
      http.getByText("HTTP selected: Ada Lovelace, locale fr")
    ).toBeVisible();

    const release = makeGate();
    await page.route("**/api/users/1?*", async (route) => {
      if (route.request().method() === "DELETE") {
        await release.promise;
      }
      await route.continue();
    });
    const started = page.waitForRequest((request) =>
      isHttpRequest(request, "DELETE", "/users/1")
    );
    try {
      await http
        .getByRole("button", { name: "Delete HTTP Ada Lovelace" })
        .click();
      await started;
      await selection.selectOption("2");
      await expect(
        http.getByText("HTTP selected: Edsger Dijkstra, locale fr")
      ).toBeVisible();
    } finally {
      release.resolve();
    }
    await expect(http.getByText("HTTP delete result: undefined")).toBeVisible();
    await expect(selection).toHaveValue("2");
    await expect(
      http.getByText("HTTP selected: Edsger Dijkstra, locale fr")
    ).toBeVisible();
  });

  test("uses a live featured user after deleting the previous one and reloading", async ({
    page,
    writeToken,
  }) => {
    await enableDemoWrites(page, writeToken);
    await expect(page.getByText("Featured: Ada Lovelace")).toBeVisible();
    await page
      .getByRole("button", { name: "Delete HTTP Ada Lovelace" })
      .click();
    await expect(page.getByText("HTTP delete result: undefined")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Featured: Edsger Dijkstra")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Infinite query" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete HTTP Edsger Dijkstra" })
    ).toBeEnabled();
  });

  test("keeps each restored directory read-only until its own refresh succeeds", async ({
    page,
  }) => {
    const rpcDelete = page.getByRole("button", {
      name: "Delete Ada Lovelace",
      exact: true,
    });
    const httpDelete = page.getByRole("button", {
      name: "Delete HTTP Ada Lovelace",
      exact: true,
    });
    await expect(rpcDelete).toBeEnabled();
    await expect(httpDelete).toBeEnabled();
    const rpcRefresh = makeGate();
    const httpRefresh = makeGate();
    await page.route("**/rpc", async (route) => {
      if (recordsRpc(route.request().postData(), "users.list")) {
        await rpcRefresh.promise;
      }
      await route.continue();
    });
    await page.route("**/api/users", async (route) => {
      await httpRefresh.promise;
      await route.continue();
    });
    try {
      await page.reload();
      await expect(rpcDelete).toBeDisabled();
      await expect(httpDelete).toBeDisabled();
      rpcRefresh.resolve();
      await expect(rpcDelete).toBeEnabled();
      await expect(httpDelete).toBeDisabled();
    } finally {
      rpcRefresh.resolve();
      httpRefresh.resolve();
    }
    await expect(httpDelete).toBeEnabled();
  });

  test("accumulates HTTP pages with distinct cursors", async ({ page }) => {
    const http = page.getByRole("region", { name: "HTTP API example" });
    await expect(http.getByText("HTTP: 4 of 12 loaded")).toBeVisible();
    await expect(http.getByText("HTTP page 1: 4 users")).toBeVisible();

    const nextPage = page.waitForResponse(
      (response) =>
        response.ok() && isHttpRequest(response.request(), "GET", "/users/page")
    );
    await http.getByRole("button", { name: "Load next HTTP page" }).click();
    const response = await nextPage;
    expect(new URL(response.url()).searchParams.get("cursor")).toBe("4");
    await expect(http.getByText("HTTP page 1: 4 users")).toBeVisible();
    await expect(http.getByText("HTTP page 2: 4 users")).toBeVisible();
    await expect(http.getByText("HTTP: 8 of 12 loaded")).toBeVisible();
  });

  test("renders the declared HTTP failure", async ({ page }) => {
    const http = page.getByRole("region", { name: "HTTP API example" });
    await http
      .getByRole("button", { name: "Trigger HTTP declared failure" })
      .click();
    const failure = http.getByRole("alert");
    await expect(failure).toContainText("EffectHttpApiQueryError");
    await expect(failure).toContainText("diagnostics");
    await expect(failure).toContainText("fail");
    await expect(failure).toContainText("DiagnosticFailure");
    await expect(failure).toContainText("requested-failure");
  });

  test("cancels concurrent RPC and HTTP queries independently", async ({
    page,
  }) => {
    const http = page.getByRole("region", { name: "HTTP API example" });
    let httpSettled = false;
    const observeCompletion = (completed: Request) => {
      if (isHttpRequest(completed, "POST", "/diagnostics/slow")) {
        httpSettled = true;
      }
    };
    page.on("requestfinished", observeCompletion);
    page.on("requestfailed", observeCompletion);
    const started = page.waitForRequest((request) =>
      isHttpRequest(request, "POST", "/diagnostics/slow")
    );
    await http.getByRole("button", { name: "Start slow HTTP query" }).click();
    const request = await started;
    await expect(http.getByText("HTTP: Ready to cancel")).toBeVisible();

    await page
      .getByRole("button", { name: "Start slow query", exact: true })
      .click();
    await expect(
      page.getByText("Ready to cancel", { exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel query", exact: true })
      .click();
    await expect(
      page.getByText("Server interruptions: 1", { exact: true })
    ).toBeVisible();
    const statusUrl = new URL(request.url());
    const operationId = statusUrl.searchParams.get("operationId");
    expect(operationId).not.toBeNull();
    if (operationId === null) {
      throw new Error("The started HTTP query must include its operation ID");
    }
    statusUrl.pathname = `/api/diagnostics/operations/${encodeURIComponent(operationId)}`;
    statusUrl.search = "";
    const status = await page.request.get(statusUrl.toString());
    expect(status.ok()).toBe(true);
    expect(await status.json()).toEqual({
      started: 1,
      interrupted: 0,
      completed: 0,
    });
    await expect(
      http.getByRole("button", { name: "Cancel HTTP query" })
    ).toBeEnabled();
    expect(httpSettled).toBe(false);
    expect(request.failure()).toBeNull();

    const aborted = page.waitForEvent(
      "requestfailed",
      (failed) => failed === request
    );
    await http.getByRole("button", { name: "Cancel HTTP query" }).click();
    await aborted;
    expect(request.failure()).not.toBeNull();
    await expect(http.getByText("HTTP: Server interruptions: 1")).toBeVisible();
  });
});

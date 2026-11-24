import { expect } from "@playwright/test";

import {
  exampleTest,
  prepareExampleApplication,
  recordsRpc,
  startExampleTest,
} from "./example-application.ts";

for (const [name, test] of [
  ["Vite React", exampleTest],
  ["TanStack Start", startExampleTest],
] as const) {
  test(`${name} pauses user lookup and preserves selection and cache options`, async ({
    exampleUrl,
    page,
  }) => {
    let lookupRequests = 0;
    page.on("request", (request) => {
      const body = request.postData();
      if (
        recordsRpc(body, "users.get") &&
        /"id"\s*:\s*2[,}]/u.test(body ?? "")
      ) {
        lookupRequests += 1;
      }
    });
    await page.clock.install();
    await prepareExampleApplication(page, exampleUrl);
    const lookup = page.getByRole("region", {
      name: "Conditional user lookup",
    });
    const select = lookup.getByLabel("User to inspect");
    await expect(
      lookup.getByText("Choose a user to start the query.")
    ).toBeVisible();
    await page.getByRole("button", { name: "Read cached directory" }).click();
    await expect(page.getByText("Cached directory: 12 users")).toBeVisible();
    expect(lookupRequests).toBe(0);

    await select.selectOption("2");
    await expect(
      lookup.getByText("Selected user: Edsger Dijkstra (en)")
    ).toBeVisible();
    expect(lookupRequests).toBe(1);

    await select.selectOption("");
    await expect(
      lookup.getByText("Choose a user to start the query.")
    ).toBeVisible();
    await expect(
      lookup.getByText("Selected user: Edsger Dijkstra (en)")
    ).toHaveCount(0);
    await select.selectOption("2");
    await expect(
      lookup.getByText("Selected user: Edsger Dijkstra (en)")
    ).toBeVisible();
    await expect(lookup.getByText("Loading selected user…")).toHaveCount(0);
    expect(lookupRequests).toBe(1);

    await select.selectOption("");
    await page.clock.fastForward(30_001);
    await select.selectOption("2");
    await expect(
      lookup.getByText("Selected user: Edsger Dijkstra (en)")
    ).toBeVisible();
    await expect(lookup.getByText("Loading selected user…")).toHaveCount(0);
    await expect.poll(() => lookupRequests).toBe(2);
  });
}

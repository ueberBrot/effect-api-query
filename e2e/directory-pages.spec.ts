import { directoryLimits } from "@effect-api-query/contracts";
import { expect } from "@playwright/test";

import {
  enableDemoWrites,
  exampleTest as test,
  isHttpRequest,
  recordsRpc,
} from "./example-application.ts";

for (const exampleHost of ["start", "standalone"] as const) {
  test.describe(`${exampleHost} directory pages`, () => {
    test.use({ exampleHost });

    test("shows a bounded preview and loads users beyond it on demand", async ({
      exampleUrl,
      page,
      writeToken,
    }) => {
      const extraUsers = directoryLimits.previewSize - 12 + 1;
      const lastName = `Additional user ${String(extraUsers)}`;
      for (let index = 1; index <= extraUsers; index += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const created = await page.request.post(`${exampleUrl}/api/users`, {
          data: { name: `Additional user ${String(index)}` },
        });
        expect(created.ok()).toBe(true);
      }

      const requests: string[] = [];
      page.on("request", (request) => {
        if (
          recordsRpc(request.postData(), "users.list") ||
          recordsRpc(request.postData(), "users.page") ||
          isHttpRequest(request, "GET", "/users") ||
          isHttpRequest(request, "GET", "/users/page")
        ) {
          requests.push(request.url());
        }
      });
      const document = await page.goto(exampleUrl);
      if (exampleHost === "start") {
        const html = await document?.text();
        expect(html).toContain("Additional user 1");
        expect(html).not.toContain(lastName);
      }
      await expect(page.getByText("16 users in one response")).toBeVisible();
      await expect(
        page.getByText("4 of 17 loaded", { exact: true })
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Read cached directory", exact: true })
        .click();
      await expect(page.getByText("Cached directory: 16 users")).toBeVisible();
      await expect(page.getByText(lastName, { exact: false })).toHaveCount(0);
      if (exampleHost === "start") {
        expect(requests).toEqual([]);
      }

      /* oxlint-disable eslint/no-await-in-loop */
      for (const loaded of [8, 12, 16]) {
        await page.getByRole("button", { name: "Load next 4 users" }).click();
        await expect(
          page.getByText(`${String(loaded)} of 17 loaded`, { exact: true })
        ).toBeVisible();
      }
      /* oxlint-enable eslint/no-await-in-loop */
      await page.getByRole("button", { name: "Load next 1 users" }).click();
      await expect(
        page.getByText(`#17 ${lastName}`, { exact: true })
      ).toBeVisible();

      if (exampleHost === "start") {
        requests.length = 0;
        const httpDocument = await page.goto(`${exampleUrl}/http`);
        const html = await httpDocument?.text();
        expect(html).toContain("Additional user 1");
        expect(html).not.toContain(lastName);
      }
      await page
        .getByRole("button", { name: "Read cached HTTP directory" })
        .click();
      await expect(
        page.getByText("HTTP cached directory: 16 users")
      ).toBeVisible();
      await expect(page.getByText("HTTP: 4 of 17 loaded")).toBeVisible();
      if (exampleHost === "start") {
        expect(requests).toEqual([]);
      } else {
        await expect(
          page.getByRole("button", { name: `Delete ${lastName}`, exact: true })
        ).toBeVisible();
      }
      await enableDemoWrites(page, writeToken);
      /* oxlint-disable eslint/no-await-in-loop */
      for (const loaded of [8, 12, 16, 17]) {
        await page.getByRole("button", { name: "Load next HTTP page" }).click();
        await expect(
          page.getByText(`HTTP: ${String(loaded)} of 17 loaded`)
        ).toBeVisible();
      }
      /* oxlint-enable eslint/no-await-in-loop */
      const httpDelete = page.getByRole("button", {
        name: `Delete HTTP ${lastName}`,
      });
      await expect(httpDelete).toBeVisible();
      const deletion = page.waitForResponse((response) =>
        exampleHost === "start"
          ? isHttpRequest(response.request(), "DELETE", "/users/17")
          : recordsRpc(response.request().postData(), "users.delete")
      );
      await (
        exampleHost === "start"
          ? httpDelete
          : page.getByRole("button", {
              name: `Delete ${lastName}`,
              exact: true,
            })
      ).click();
      const deleted = await deletion;
      const missing = await page.request.get(`${exampleUrl}/api/users/17`);
      expect(deleted.ok()).toBe(true);
      expect(missing.status()).toBe(404);
      await expect(page.getByText("HTTP: 16 of 16 loaded")).toBeVisible();
      await expect(page.getByText(lastName, { exact: false })).toHaveCount(0);
    });
  });
}

import { expect, test } from "@playwright/test";

for (const application of [
  { name: "Vite React", url: "http://127.0.0.1:4173/" },
  { name: "TanStack Start", url: "http://127.0.0.1:3000/workflows" },
]) {
  test.describe(application.name, () => {
    const baseUrl = application.url;

    test("a first typed write seeds the generated cache entry", async ({
      page,
    }) => {
      await page.goto(`${baseUrl}?example=minimal`);
      await expect(
        page.getByRole("heading", { name: "First read and write" })
      ).toBeVisible();
      const write = page.getByRole("button", {
        name: "Write and seed the cache",
      });
      await expect(write).toBeEnabled();
      await write.click();
      await expect(
        page.getByText("Current title: My first typed write", { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText("The mutation response updated the exact query key.")
      ).toBeVisible();
    });

    test("metadata writes expose typed validation and revision conflicts", async ({
      page,
    }) => {
      await page.goto(`${baseUrl}?example=metadata`);
      await expect(page.getByText("HTTP status: 200")).toBeVisible();
      await page
        .getByRole("button", { name: "Remember this revision" })
        .click();
      await page.getByLabel("Document title").fill("blocked");
      await page
        .getByRole("button", { name: "Save title", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveText(
        "Use 1–80 characters and omit the word blocked."
      );
      await page.getByLabel("Document title").fill("Reviewed release");
      await page
        .getByRole("button", { name: "Save title", exact: true })
        .click();
      await expect(
        page.getByText("Saved Reviewed release", { exact: true })
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Try remembered revision" })
        .click();
      await expect(page.getByRole("alert")).toHaveText(
        "The document changed. Read the latest revision before saving again."
      );
    });

    for (const format of ["sse", "ndjson"]) {
      test(`${format} retains four updates, exposes the latest value, and cancels`, async ({
        page,
      }) => {
        await page.goto(`${baseUrl}?example=streams`);
        await page.getByLabel("HTTP stream format").selectOption(format);
        await page.getByRole("button", { name: "Start streams" }).click();
        await expect(
          page.getByText("Latest update: 8", { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText("Streams idle", { exact: true })
        ).toBeVisible();
        await expect(
          page
            .getByRole("list", { name: "Retained HTTP history" })
            .getByRole("listitem")
        ).toHaveText(["Update 5", "Update 6", "Update 7", "Update 8"]);
        await page.getByRole("button", { name: "Start streams" }).click();
        await expect(
          page.getByRole("button", { name: "Stop streams" })
        ).toBeEnabled();
        await page.getByRole("button", { name: "Stop streams" }).click();
        await expect(
          page.getByText("Streams idle", { exact: true })
        ).toBeVisible();
      });
    }

    test("multipart upload reports the received file and rejects an oversized selection", async ({
      page,
    }) => {
      await page.goto(`${baseUrl}?example=upload`);
      await page.getByLabel("Attachment", { exact: true }).setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      });
      await page.getByRole("button", { name: "Upload attachment" }).click();
      await expect(
        page.getByText("Received notes.txt: 5 bytes", { exact: true })
      ).toBeVisible();
      await page.getByLabel("Attachment", { exact: true }).setInputFiles({
        name: "large.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(65_537),
      });
      await page.getByRole("button", { name: "Upload attachment" }).click();
      await expect(page.getByRole("alert")).toHaveText(
        "Choose a nonempty file up to 64 KiB."
      );
    });

    test("schema sharing preserves memoized cards until their decoded data changes", async ({
      page,
    }) => {
      await page.goto(`${baseUrl}?example=sharing`);
      const cards = page
        .getByRole("list", { name: "Decoded readings" })
        .getByRole("listitem");
      await expect(cards).toHaveCount(2);
      const before = await cards.locator("output").allTextContents();
      const fetched = page.getByLabel("Last readings fetch");
      const previousFetch = await fetched.textContent();
      await page
        .getByRole("button", { name: "Refetch equal readings" })
        .click();
      await expect(fetched).not.toHaveText(previousFetch ?? "");
      await expect(cards.locator("output")).toHaveText(before);
      await page.getByRole("button", { name: "Change first reading" }).click();
      await expect
        .poll(async () =>
          Number(await cards.nth(0).locator("output").textContent())
        )
        .toBeGreaterThan(Number(before[0]));
      await expect(cards.nth(1).locator("output")).toHaveText(before[1] ?? "");
      await page.getByLabel("Reuse equivalent decoded readings").uncheck();
      await page
        .getByRole("button", { name: "Refetch equal readings" })
        .click();
      await expect
        .poll(async () =>
          Number(await cards.nth(1).locator("output").textContent())
        )
        .toBeGreaterThan(Number(before[1]));
      await page
        .getByRole("combobox", { name: "Room", exact: true })
        .selectOption("office");
      await expect(cards.nth(0)).toContainText("Reading 1: 25");
    });

    for (const { scenario, sequences, refreshes } of [
      {
        scenario: "disconnect",
        sequences: "1, 2, 3, 4, 5, 6, 7, 8",
        refreshes: 0,
      },
      { scenario: "gap", sequences: "1, 2, 3, 5, 6, 7, 8", refreshes: 1 },
      { scenario: "expired", sequences: "1, 2, 3, 6, 7, 8", refreshes: 1 },
    ]) {
      test(`event delivery recovers ${scenario}`, async ({ page }) => {
        await page.goto(`${baseUrl}?example=events`);
        await page.getByLabel("Delivery scenario").selectOption(scenario);
        await page.getByRole("button", { name: "Consume events" }).click();
        await expect(
          page.getByText(`Delivered sequences: ${sequences}`, { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText("Connection: completed", { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText(`Authoritative refreshes: ${String(refreshes)}`, {
            exact: true,
          })
        ).toBeVisible();
      });
    }
  });
}

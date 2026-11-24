import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { expect, test as base } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { Schema } from "effect";

const decodeOrigin = Schema.decodeUnknownSync(Schema.String);

export const exampleTest = base.extend<{
  exampleHost: "standalone" | "start";
  exampleUrl: string;
}>({
  exampleHost: ["standalone", { option: true }],
  exampleUrl: [
    async ({ exampleHost }, use) => {
      const host = fork(
        fileURLToPath(new URL("example-host.ts", import.meta.url)),
        [exampleHost],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "inherit", "ipc"],
        }
      );
      const exited = once(host, "exit");
      try {
        const message = await Promise.race([
          once(host, "message", { signal: AbortSignal.timeout(15_000) }),
          (async () => {
            await exited;
            throw new Error(
              `Example host exited during startup (${host.exitCode ?? host.signalCode})`
            );
          })(),
        ]);
        await use(decodeOrigin(message[0]));
      } finally {
        if (host.connected) {
          host.disconnect();
        }
        const forceExit = setTimeout(() => {
          host.kill("SIGKILL");
        }, 5000).unref();
        try {
          await exited;
        } finally {
          clearTimeout(forceExit);
        }
      }
      expect(host.exitCode, "example host exit code").toBe(0);
    },
    { auto: true },
  ],
});

export const startExampleTest = exampleTest.extend({ exampleHost: "start" });

export const prepareExampleApplication = async (
  page: Page,
  exampleUrl: string
): Promise<void> => {
  await page.goto(exampleUrl);
  await expect(
    page.getByRole("heading", {
      name: "Compare full queries, pages, and streams",
    })
  ).toBeVisible();
  await expect(page.getByText("Ada Lovelace", { exact: true })).toBeVisible();
};

export const recordsRpc = (postData: string | null, rpcTag: string): boolean =>
  postData?.includes(rpcTag) ?? false;

export const isHttpRequest = (
  request: Request,
  method: string,
  pathname: string
): boolean =>
  request.method() === method &&
  new URL(request.url()).pathname === `/api${pathname}`;

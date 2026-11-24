import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { Effect, Exit, Scope } from "effect";
import { preview } from "vite";
import type { PreviewOptions } from "vite";

import { startExampleRpcServer } from "../examples/server/src/index.ts";

if (process.send === undefined) {
  throw new Error("The example host requires a Playwright IPC channel");
}
const disconnected = once(process, "disconnect");

const servePreview = async (
  application: "tanstack-start" | "vite-react",
  apiTarget?: string
) => {
  process.chdir(
    fileURLToPath(new URL(`../examples/${application}`, import.meta.url))
  );
  const options: PreviewOptions = { port: 0 };
  if (apiTarget !== undefined) {
    options.proxy = { "/api": apiTarget, "/rpc": apiTarget };
  }
  const server = await preview({ preview: options });
  try {
    const address = server.resolvedUrls?.local[0];
    if (address === undefined) {
      throw new Error("The example preview did not bind a loopback address");
    }
    if (process.connected) {
      process.send?.(new URL(address).origin);
    }
    await disconnected;
  } finally {
    await server.close();
  }
};

if (process.argv[2] === "start") {
  await servePreview("tanstack-start");
} else {
  const scope = Scope.makeUnsafe();
  try {
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(scope))
    );
    await servePreview("vite-react", server.url);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

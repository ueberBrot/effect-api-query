import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { preview } from "vite";
import type { PreviewOptions } from "vite";

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
    const proxy = { target: apiTarget, changeOrigin: false };
    options.proxy = { "/api": proxy, "/rpc": proxy };
  }
  const server = await preview({ configLoader: "native", preview: options });
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
  const { Effect, Exit, Scope } = await import("effect");
  const { startExampleRpcServer } =
    await import("../examples/server/src/index.ts");
  const scope = Scope.makeUnsafe();
  try {
    const server = await Effect.runPromise(
      startExampleRpcServer({
        writeToken: process.env["EXAMPLE_WRITE_TOKEN"],
      }).pipe(Scope.provide(scope))
    );
    await servePreview("vite-react", server.url);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

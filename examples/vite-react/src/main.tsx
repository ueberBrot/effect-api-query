import {
  HttpWorkflowsExample,
  WorkflowPage,
} from "@effect-api-query/shared/http-workflows/app.tsx";
import { startHttpWorkflows } from "@effect-api-query/shared/http-workflows/application.ts";
import { Result, Schema } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ViteReactExample } from "./app.tsx";
import { startViteReactApplication } from "./lib/application.ts";

import "./styles/tailwind.css";

const rpcUrl = import.meta.env.VITE_RPC_URL ?? "/rpc";
const container = document.querySelector("#root");

if (container === null) {
  throw new Error("The Vite React root element is missing");
}

const startSelectedExample = async () => {
  const page = Schema.decodeUnknownResult(WorkflowPage)(
    new URL(globalThis.location.href).searchParams.get("example")
  );
  const httpBaseUrl =
    import.meta.env.VITE_HTTP_BASE_URL ?? globalThis.location.origin;
  if (Result.isSuccess(page)) {
    const application = await startHttpWorkflows(httpBaseUrl);
    return {
      content: (
        <HttpWorkflowsExample application={application} page={page.success} />
      ),
      dispose: application.dispose,
    };
  }
  const application = await startViteReactApplication({
    rpcUrl,
    httpBaseUrl,
    directoryStorage: globalThis.sessionStorage,
  });
  return {
    content: <ViteReactExample application={application} />,
    dispose: async () => application.dispose({ discardPersistence: false }),
  };
};
const application = await startSelectedExample();
const root = createRoot(container);
root.render(<StrictMode>{application.content}</StrictMode>);

let disposed = false;
const dispose = () => {
  if (disposed) {
    return;
  }
  disposed = true;
  root.unmount();
  void (async () => {
    try {
      await application.dispose();
    } catch (error) {
      console.error("Vite resource cleanup failed", error);
    }
  })();
};

globalThis.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(dispose);
}

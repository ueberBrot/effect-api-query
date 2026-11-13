import {
  HttpWorkflowsExample,
  WorkflowPage,
} from "@effect-api-query/shared/http-workflows/app.tsx";
import { startHttpWorkflows } from "@effect-api-query/shared/http-workflows/application.ts";
import type { HttpWorkflows } from "@effect-api-query/shared/http-workflows/application.ts";
import { createFileRoute } from "@tanstack/react-router";
import { Result, Schema } from "effect";
import { useEffect, useState } from "react";

import { EffectErrorDetails } from "../components/effect-error-details.tsx";
import { reportCleanupFailure } from "../lib/application.ts";

const WorkflowsPage = () => {
  const { example } = Route.useSearch();
  const [application, setApplication] = useState<HttpWorkflows>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    let acquired: HttpWorkflows | undefined;
    // Event consumption belongs to the browser, never the SSR request owner.
    void (async () => {
      try {
        const value = await startHttpWorkflows(window.location.origin);
        acquired = value;
        if (active) {
          setApplication(value);
        } else {
          await reportCleanupFailure(value.dispose());
        }
      } catch (error_) {
        if (active) {
          setError(error_);
        }
      }
    })();
    const dispose = () => {
      active = false;
      if (acquired !== undefined) {
        void reportCleanupFailure(acquired.dispose());
      }
    };
    window.addEventListener("pagehide", dispose, { once: true });
    return () => {
      window.removeEventListener("pagehide", dispose);
      dispose();
    };
  }, []);
  return application === undefined ? (
    <main className="p-8">
      <p>Opening HTTP workflows…</p>
      <EffectErrorDetails error={error} />
    </main>
  ) : (
    <HttpWorkflowsExample
      application={application}
      page={example}
      basePath="/workflows"
    />
  );
};

export const Route = createFileRoute("/workflows")({
  component: WorkflowsPage,
  validateSearch: (search: { readonly example?: unknown }) => {
    const result = Schema.decodeUnknownResult(WorkflowPage)(search.example);
    return {
      example: Result.isSuccess(result) ? result.success : ("events" as const),
    };
  },
});

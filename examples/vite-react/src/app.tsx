import { DemoWriteAccess } from "@effect-api-query/shared/demo-write-access.tsx";
import { WorkflowNavigation } from "@effect-api-query/shared/http-workflows/app.tsx";
import { createQueryUtilsContext } from "@ueberbrot/effect-api-query/react";

import { CommandsSection } from "./components/sections/commands-section.tsx";
import { DiagnosticsSection } from "./components/sections/diagnostics-section.tsx";
import { HttpSection } from "./components/sections/http-section.tsx";
import { MutationsSection } from "./components/sections/mutations-section.tsx";
import { QueriesSection } from "./components/sections/queries-section.tsx";
import type { ViteReactApplication } from "./lib/application.ts";

const { Provider, useQueryUtils } =
  createQueryUtilsContext<ViteReactApplication>();

const ExampleContent = () => {
  const application = useQueryUtils();
  return (
    <div className="app-backdrop text-text-secondary min-h-screen antialiased">
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-12 md:grid-cols-2">
        <header className="border-border border-l-brand-600 bg-card shadow-shadow/50 border p-6 shadow-2xl md:col-span-2 md:border-l-4 md:p-8">
          <WorkflowNavigation />
          <DemoWriteAccess />
          <h1 className="display-heading tracking-display text-foreground max-w-4xl text-3xl font-black sm:text-5xl">
            Compare full queries, pages, and streams
          </h1>
          <p className="text-muted-foreground mt-5 max-w-3xl leading-7">
            See how generated Effect HTTP and RPC options share a directory,
            append cursor-based pages, retain stream history, and display the
            latest live value.
          </p>
        </header>

        <HttpSection application={application} />
        <QueriesSection application={application} />
        <MutationsSection application={application} />
        <DiagnosticsSection application={application} />
        <CommandsSection application={application} />
      </main>
    </div>
  );
};

export const ViteReactExample = ({
  application,
}: {
  readonly application: ViteReactApplication;
}) => (
  <Provider utils={application} client={application.queryClient}>
    <ExampleContent />
  </Provider>
);

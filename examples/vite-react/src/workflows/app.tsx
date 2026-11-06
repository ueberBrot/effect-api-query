import { QueryClientProvider } from "@tanstack/react-query";
import { Schema } from "effect";

import type { HttpWorkflows } from "./application.ts";
import { DocumentExample, MinimalExample } from "./document.tsx";
import { EventsExample } from "./events.tsx";
import { ReadingsExample } from "./readings.tsx";
import { StreamsExample } from "./streams.tsx";
import { UploadExample } from "./upload.tsx";

export const WorkflowPage = Schema.Literals([
  "minimal",
  "metadata",
  "streams",
  "upload",
  "sharing",
  "events",
]);
const pages = {
  minimal: { title: "First read and write", component: MinimalExample },
  metadata: { title: "HTTP metadata and ETags", component: DocumentExample },
  streams: { title: "HTTP streaming", component: StreamsExample },
  upload: { title: "Multipart upload", component: UploadExample },
  sharing: { title: "Decoded-value sharing", component: ReadingsExample },
  events: { title: "Event recovery", component: EventsExample },
};

export const WorkflowNavigation = () => (
  <nav aria-label="Examples" className="flex flex-wrap gap-4 text-sm">
    <a href="/">Directory</a>
    {WorkflowPage.literals.map((page) => (
      <a href={`/?example=${page}`} key={page}>
        {pages[page].title}
      </a>
    ))}
  </nav>
);

export const HttpWorkflowsExample = ({
  application,
  page,
}: {
  readonly application: HttpWorkflows;
  readonly page: typeof WorkflowPage.Type;
}) => {
  const { title, component: Example } = pages[page];
  return (
    <QueryClientProvider client={application.queryClient}>
      <main className="mx-auto grid max-w-4xl gap-8 px-5 py-12">
        <WorkflowNavigation />
        <h1 className="display-heading text-foreground text-3xl font-bold">
          {title}
        </h1>
        <Example application={application} />
      </main>
    </QueryClientProvider>
  );
};

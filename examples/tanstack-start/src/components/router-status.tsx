import type { ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

const StatusPage = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <main className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
    <section className="border-border bg-card shadow-shadow/40 border p-6 shadow-2xl">
      <h1 className="display-heading text-foreground text-3xl font-black tracking-tight">
        {title}
      </h1>
      {children}
    </section>
  </main>
);

export const PendingPage = () => (
  <StatusPage title="Loading route">
    <p className="text-muted-foreground">Loading queries…</p>
  </StatusPage>
);

export const NotFoundPage = () => (
  <StatusPage title="Page not found">
    <p className="text-muted-foreground">No route matches this URL.</p>
  </StatusPage>
);

export const ErrorPage = ({ error, reset }: ErrorComponentProps) => (
  <StatusPage title="Route failed">
    <p className="border-destructive-900/80 border-l-destructive-600 bg-destructive-950/50 text-destructive-200 border border-l-4 p-4 text-sm">
      {error instanceof Error ? error.message : String(error)}
    </p>
    <button
      className="border-brand-500 bg-brand-600 text-primary-foreground hover:bg-brand-500 rounded-sm border px-4 py-2 text-sm font-bold"
      onClick={reset}
      type="button"
    >
      Try again
    </button>
  </StatusPage>
);

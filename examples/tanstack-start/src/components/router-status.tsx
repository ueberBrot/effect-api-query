import type { ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

const StatusPage = ({
  children,
  title,
}: {
  readonly children: ReactNode
  readonly title: string
}) => (
  <main className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
    <section className="border border-border bg-card p-6 shadow-2xl shadow-shadow/40">
      <h1 className="display-heading text-3xl font-black tracking-tight text-foreground">
        {title}
      </h1>
      {children}
    </section>
  </main>
)

export const PendingPage = () => (
  <StatusPage title="Loading route">
    <p className="text-muted-foreground">Loading generated RPC queries…</p>
  </StatusPage>
)

export const NotFoundPage = () => (
  <StatusPage title="Page not found">
    <p className="text-muted-foreground">No route matches this URL.</p>
  </StatusPage>
)

export const ErrorPage = ({ error, reset }: ErrorComponentProps) => (
  <StatusPage title="Route failed">
    <p className="border border-l-4 border-destructive-900/80 border-l-destructive-600 bg-destructive-950/50 p-4 text-sm text-destructive-200">
      {error instanceof Error ? error.message : String(error)}
    </p>
    <button
      className="rounded-sm border border-brand-500 bg-brand-600 px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-brand-500"
      onClick={reset}
      type="button"
    >
      Try again
    </button>
  </StatusPage>
)

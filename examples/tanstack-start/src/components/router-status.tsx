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
    <section className="border border-zinc-800 bg-[#111113] p-6 shadow-2xl shadow-black/40">
      <h1 className="display-heading text-3xl font-black tracking-tight text-zinc-50">{title}</h1>
      {children}
    </section>
  </main>
)

export const PendingPage = () => (
  <StatusPage title="Loading route">
    <p className="text-zinc-400">Loading generated RPC queries…</p>
  </StatusPage>
)

export const NotFoundPage = () => (
  <StatusPage title="Page not found">
    <p className="text-zinc-400">No route matches this URL.</p>
  </StatusPage>
)

export const ErrorPage = ({ error, reset }: ErrorComponentProps) => (
  <StatusPage title="Route failed">
    <p className="border border-l-4 border-red-900/80 border-l-red-600 bg-red-950/50 p-4 text-sm text-red-200">
      {error instanceof Error ? error.message : String(error)}
    </p>
    <button
      className="rounded-sm border border-violet-500 bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
      onClick={reset}
      type="button"
    >
      Try again
    </button>
  </StatusPage>
)

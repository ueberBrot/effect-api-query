import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo } from 'react'

import { CommandsSection } from './components/sections/commands-section.tsx'
import { DiagnosticsSection } from './components/sections/diagnostics-section.tsx'
import { HttpSection } from './components/sections/http-section.tsx'
import { MutationsSection } from './components/sections/mutations-section.tsx'
import { QueriesSection } from './components/sections/queries-section.tsx'
import type { ViteReactApplication } from './lib/application.ts'

const ExampleContent = ({ application }: { readonly application: ViteReactApplication }) => (
  <div className="app-backdrop min-h-screen text-text-secondary antialiased">
    <main className="mx-auto grid max-w-7xl gap-5 px-5 py-12 md:grid-cols-2">
      <header className="border border-border border-l-brand-600 bg-card p-6 shadow-2xl shadow-shadow/50 md:col-span-2 md:border-l-4 md:p-8">
        <h1 className="display-heading max-w-4xl text-3xl font-black tracking-display text-foreground sm:text-5xl">
          Compare full queries, pages, and streams
        </h1>
        <p className="mt-5 max-w-3xl leading-7 text-muted-foreground">
          See how generated Effect HTTP and RPC options share a directory, append cursor-based
          pages, retain stream history, and display the latest live value.
        </p>
      </header>

      <HttpSection application={application} />
      <QueriesSection application={application} />
      <MutationsSection application={application} />
      <DiagnosticsSection application={application} />
      <CommandsSection application={application} />
    </main>
  </div>
)

export const ViteReactExample = ({
  application,
}: {
  readonly application: ViteReactApplication
}) => {
  const boundary = useMemo(
    () => ({ client: application.queryClient, key: globalThis.crypto.randomUUID() }),
    [application.queryClient],
  )
  return (
    <QueryClientProvider key={boundary.key} client={boundary.client}>
      <ExampleContent application={application} />
    </QueryClientProvider>
  )
}

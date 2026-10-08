import type { ReactNode } from 'react'

export const PageLayout = ({
  children,
  description,
  title,
}: {
  readonly children: ReactNode
  readonly description: ReactNode
  readonly title: string
}) => (
  <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
    <h1 className="display-heading max-w-4xl text-4xl font-black tracking-display text-foreground sm:text-6xl">
      {title}
    </h1>
    <div className="mt-5 h-1 max-w-16 bg-brand-600" />
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{description}</p>
    {children}
  </main>
)

export const Panel = ({
  children,
  title,
}: {
  readonly children: ReactNode
  readonly title: string
}) => (
  <section className="border border-border bg-card p-6 shadow-2xl shadow-shadow/40">
    <h2 className="display-heading text-2xl font-black text-foreground">{title}</h2>
    {children}
  </section>
)

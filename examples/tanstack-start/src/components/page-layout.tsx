import type { ReactNode } from "react";

export const PageLayout = ({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: ReactNode;
  readonly title: string;
}) => (
  <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
    <h1 className="display-heading tracking-display text-foreground max-w-4xl text-4xl font-black sm:text-6xl">
      {title}
    </h1>
    <div className="bg-brand-600 mt-5 h-1 max-w-16" />
    <p className="text-muted-foreground mt-5 max-w-3xl text-lg leading-8">
      {description}
    </p>
    {children}
  </main>
);

export const Panel = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <section className="border-border bg-card shadow-shadow/40 border p-6 shadow-2xl">
    <h2 className="display-heading text-foreground text-2xl font-black">
      {title}
    </h2>
    {children}
  </section>
);

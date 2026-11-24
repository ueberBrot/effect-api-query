import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { isEffectRpcQueryError } from "@ueberbrot/effect-api-query";
import { Cause } from "effect";
import type { ReactNode } from "react";

import { PageLayout, Panel } from "../components/page-layout.tsx";
import { featuredUserDescriptor } from "../lib/featured-user.ts";

// oxlint-disable-next-line anti-slop/no-unknown-parameters
const isMissingUser = (error: unknown): boolean =>
  isEffectRpcQueryError(error) &&
  error.rpcTag === "users.get" &&
  error.cause.reasons.length > 0 &&
  error.cause.reasons.every(
    (reason) => Cause.isFailReason(reason) && reason.error === "user-not-found"
  );

const FeaturedUserLayout = ({ children }: { readonly children: ReactNode }) => (
  <PageLayout
    description="The loader primes a generated user query. Typed navigation reads the same cached result."
    title="Featured user"
  >
    <div className="mt-8">{children}</div>
  </PageLayout>
);

const MissingFeaturedUser = () => (
  <FeaturedUserLayout>
    <p>The featured user is no longer available.</p>
  </FeaturedUserLayout>
);

const FeaturedUserPage = () => {
  const { rpcQuery } = Route.useRouteContext();
  const selection = Route.useLoaderData();
  const bound = featuredUserDescriptor(rpcQuery).bind(selection);
  const featured = useSuspenseQuery(
    bound.leaf.queryOptions({ input: bound.input })
  );
  if (isMissingUser(featured.error)) {
    return <MissingFeaturedUser />;
  }

  return (
    <FeaturedUserLayout>
      <Panel title={featured.data.name}>
        <p className="text-muted-foreground mt-2 text-sm">
          User {featured.data.id}, locale {featured.data.locale}
        </p>
      </Panel>
    </FeaturedUserLayout>
  );
};

export const Route = createFileRoute("/details")({
  component: FeaturedUserPage,
  loader: {
    handler: async ({ context }) => {
      const descriptor = featuredUserDescriptor(context.rpcQuery);
      const selection = descriptor.capture({ id: 1 });
      const bound = descriptor.bind(selection);
      try {
        await context.queryClient.query({
          ...bound.leaf.queryOptions({ input: bound.input }),
          staleTime: 0,
        });
      } catch (error) {
        if (isMissingUser(error)) {
          // oxlint-disable-next-line typescript/only-throw-error
          throw notFound();
        }
        throw error;
      }
      return selection;
    },
    staleReloadMode: "blocking",
  },
  notFoundComponent: MissingFeaturedUser,
});

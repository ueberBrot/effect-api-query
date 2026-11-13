import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageLayout, Panel } from "../components/page-layout.tsx";
import { featuredUserDescriptor } from "../lib/featured-user.ts";

const FeaturedUserPage = () => {
  const { rpcQuery } = Route.useRouteContext();
  const selection = Route.useLoaderData();
  const bound = featuredUserDescriptor(rpcQuery).bind(selection);
  const featured = useSuspenseQuery(
    bound.leaf.queryOptions({ input: bound.input })
  );

  return (
    <PageLayout
      description="The loader primes a generated user query. Typed navigation reads the same cached result."
      title="Featured user"
    >
      <div className="mt-8">
        <Panel title={featured.data.name}>
          <p className="text-muted-foreground mt-2 text-sm">
            User {featured.data.id}, locale {featured.data.locale}
          </p>
        </Panel>
      </div>
    </PageLayout>
  );
};

export const Route = createFileRoute("/details")({
  component: FeaturedUserPage,
  loader: async ({ context }) => {
    const descriptor = featuredUserDescriptor(context.rpcQuery);
    const selection = descriptor.capture({ id: 1 });
    const bound = descriptor.bind(selection);
    await context.queryClient.query({
      ...bound.leaf.queryOptions({ input: bound.input }),
      staleTime: "static",
    });
    return selection;
  },
});

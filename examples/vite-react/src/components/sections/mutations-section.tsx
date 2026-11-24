import { ActionButton } from "@effect-api-query/shared/ui/action-button.tsx";
import { useQuery } from "@tanstack/react-query";

import type { ViteReactApplication } from "../../lib/application.ts";
import { CreateUserForm } from "../users/create-user-form.tsx";

export const MutationsSection = ({
  application,
}: {
  readonly application: ViteReactApplication;
}) => {
  const { rpcQuery } = application;
  const voidQuery = useQuery(
    rpcQuery.diagnostics.cancel.queryOptions({
      enabled: false,
      input: { operationId: "no-active-operation" },
    })
  );

  return (
    <section className="border-border bg-card shadow-shadow/40 space-y-4 border p-6 shadow-2xl">
      <h2 className="display-heading text-foreground text-2xl font-bold">
        Mutations and invalidation
      </h2>
      <CreateUserForm application={application} />
      <div className="flex flex-wrap gap-3">
        <ActionButton
          onClick={() => {
            void voidQuery.refetch();
          }}
          type="button"
          variant="secondary"
        >
          Run void query
        </ActionButton>
      </div>
      {voidQuery.isSuccess ? (
        <p className="text-sm">Void query result: {String(voidQuery.data)}</p>
      ) : null}
    </section>
  );
};

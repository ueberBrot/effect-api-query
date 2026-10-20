import { SeedUser } from "@effect-api-query/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";

import type { ViteReactApplication } from "../../lib/application.ts";
import { ActionButton } from "../ui/action-button.tsx";
import { EffectErrorDetails } from "../ui/effect-error-details.tsx";
import { CreateUserForm } from "../users/create-user-form.tsx";

export const MutationsSection = ({
  application,
}: {
  readonly application: ViteReactApplication;
}) => {
  const { invalidateUsers, rpcQuery, trackMutationOptions } = application;
  const voidQuery = useQuery(
    rpcQuery.diagnostics.cancel.queryOptions({
      enabled: false,
      input: { operationId: "no-active-operation" },
    })
  );
  const resetUsers = useMutation(
    trackMutationOptions(
      rpcQuery.testing.reset.mutationOptions({ onSuccess: invalidateUsers })
    )
  );
  const seedUsers = useMutation(
    trackMutationOptions(
      rpcQuery.testing.seed.mutationOptions({ onSuccess: invalidateUsers })
    )
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
            seedUsers.mutate({
              users: [
                { name: "Grace Hopper" },
                { name: "Margaret Hamilton" },
                { name: "Katherine Johnson" },
                { name: "Dorothy Vaughan" },
                { name: "Frances Allen" },
                { name: "Jean Bartik" },
                { name: "Mary Keller" },
                { name: "Sister Mary Kenneth Keller" },
              ].map((user) => new SeedUser(user)),
            });
          }}
          type="button"
        >
          Replace with eight pioneers
        </ActionButton>
        <ActionButton
          onClick={() => {
            resetUsers.mutate();
          }}
          type="button"
          variant="secondary"
        >
          Reset directory
        </ActionButton>
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
      <EffectErrorDetails error={seedUsers.error ?? resetUsers.error} />
      {resetUsers.isSuccess ? (
        <p className="text-sm">Reset result: {String(resetUsers.data)}</p>
      ) : null}
      {voidQuery.isSuccess ? (
        <p className="text-sm">Void query result: {String(voidQuery.data)}</p>
      ) : null}
    </section>
  );
};

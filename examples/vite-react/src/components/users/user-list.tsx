import type { User } from "@effect-api-query/contracts";
import { ActionButton } from "@effect-api-query/shared/ui/action-button.tsx";
import { EffectErrorDetails } from "@effect-api-query/shared/ui/effect-error-details.tsx";
import { useMutation } from "@tanstack/react-query";

import type { ViteReactApplication } from "../../lib/application.ts";

export const UserList = ({
  application,
  users,
  isSynced,
}: {
  readonly application: ViteReactApplication;
  readonly users: readonly User[] | undefined;
  readonly isSynced: boolean;
}) => {
  const { userWrites } = application;
  const deleteUser = useMutation(userWrites.rpcDelete());

  return (
    <>
      {users !== undefined && !isSynced ? (
        <p>Refresh the directory before deleting users.</p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {users?.map((user) => (
          <li
            className="border-border bg-background flex items-center justify-between gap-4 border p-3"
            key={user.id}
          >
            <span className="grid gap-0.5">
              <strong className="text-text-primary">{user.name}</strong>
              <span className="text-text-subtle text-sm">
                {user.id < 0 ? "Adding user" : `User ${String(user.id)}`},
                locale {user.locale}
              </span>
            </span>
            <ActionButton
              aria-label={`Delete ${user.name}`}
              disabled={
                !isSynced ||
                user.id < 0 ||
                (deleteUser.isPending &&
                  deleteUser.variables.id === user.id &&
                  deleteUser.variables.revision === user.revision)
              }
              onClick={() => {
                deleteUser.mutate({ id: user.id, revision: user.revision });
              }}
              type="button"
              variant="danger"
            >
              Delete
            </ActionButton>
          </li>
        ))}
      </ul>
      <EffectErrorDetails error={deleteUser.error} />
    </>
  );
};

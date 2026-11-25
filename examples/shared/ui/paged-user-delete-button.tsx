import type { User } from "@effect-api-query/contracts";

import { ActionButton } from "./action-button.tsx";

export const PagedUserDeleteButton = ({
  user,
  previewIds,
  disabled,
  transport,
  onDelete,
}: {
  readonly user: User;
  readonly previewIds: ReadonlySet<number>;
  readonly disabled: boolean;
  readonly transport: "http" | "rpc";
  readonly onDelete: (user: User) => void;
}) => {
  if (user.id <= 0 || previewIds.has(user.id)) {
    return null;
  }
  return (
    <ActionButton
      aria-label={`Delete ${transport === "http" ? "HTTP " : ""}${user.name}`}
      disabled={disabled}
      onClick={() => {
        onDelete(user);
      }}
      type="button"
      variant="danger"
    >
      Delete
    </ActionButton>
  );
};

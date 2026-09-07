import type { User } from '@effect-api-query/contracts'
import { useMutation } from '@tanstack/react-query'

import type { ViteReactApplication } from '../../lib/application.ts'
import { ActionButton } from '../ui/action-button.tsx'
import { EffectErrorDetails } from '../ui/effect-error-details.tsx'

export const UserList = ({
  application,
  users,
}: {
  readonly application: ViteReactApplication
  readonly users: ReadonlyArray<User> | undefined
}) => {
  const { invalidateUsers, rpcQuery } = application
  const deleteUser = useMutation(
    rpcQuery.users.delete.mutationOptions({
      onSuccess: invalidateUsers,
    }),
  )

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {users?.map((user) => (
          <li
            className="flex items-center justify-between gap-4 border border-zinc-800 bg-black p-3"
            key={user.id}
          >
            <span className="grid gap-0.5">
              <strong className="text-zinc-100">{user.name}</strong>
              <span className="text-sm text-zinc-500">
                User {user.id}, locale {user.locale}
              </span>
            </span>
            <ActionButton
              aria-label={`Delete ${user.name}`}
              disabled={deleteUser.isPending && deleteUser.variables.id === user.id}
              onClick={() => deleteUser.mutate({ id: user.id })}
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
  )
}

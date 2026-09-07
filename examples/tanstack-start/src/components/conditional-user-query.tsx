import type { User } from '@effect-api-query/contracts'
import { useQuery } from '@tanstack/react-query'
import { skipToken } from 'effect-api-query'
import { useState } from 'react'

import type { TanStackStartApplication } from '../lib/application.ts'
import { EffectErrorDetails } from './effect-error-details.tsx'

const displayOptions = {
  select: (user: User) => `${user.name} (${user.locale})`,
  staleTime: 30_000,
}

export const ConditionalUserQuery = ({
  rpcQuery,
  users,
}: {
  readonly rpcQuery: TanStackStartApplication['rpcQuery']
  readonly users: ReadonlyArray<User>
}) => {
  const [userId, setUserId] = useState('')
  const options = rpcQuery.users.get.queryOptions({
    ...displayOptions,
    input: userId === '' ? skipToken : { id: Number(userId) },
  })
  const user = useQuery(options)

  return (
    <section aria-label="Conditional user lookup" className="border border-zinc-800 bg-black p-5">
      <h3 className="display-heading text-xl font-bold text-zinc-100">Choose before fetching</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        The query waits until you choose a user. Clear the selection to pause it again. Reselect the
        same user within 30 seconds to reuse the cached result.
      </p>
      <label className="mt-4 grid gap-2 text-sm font-bold text-violet-300">
        User to inspect
        <select
          className="border border-zinc-700 bg-zinc-900 p-2 text-zinc-100"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">No user selected</option>
          {users.map((entry) => (
            <option key={entry.id} value={entry.id}>
              User {entry.id}: {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div aria-live="polite" className="mt-4 text-sm text-zinc-200">
        {userId === '' ? <p>Choose a user to start the query.</p> : null}
        {user.isFetching ? <p>Loading selected user…</p> : null}
        {user.data === undefined ? null : <p>Selected user: {user.data}</p>}
      </div>
      {user.error === null ? null : <EffectErrorDetails error={user.error} />}
    </section>
  )
}

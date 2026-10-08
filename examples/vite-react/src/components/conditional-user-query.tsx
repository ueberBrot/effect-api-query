import type { User } from '@effect-api-query/contracts'
import { useQuery } from '@tanstack/react-query'
import { skipToken } from 'effect-api-query'
import { useState } from 'react'

import type { ViteReactApplication } from '../lib/application.ts'
import { EffectErrorDetails } from './ui/effect-error-details.tsx'

const displayOptions = {
  select: (user: User) => `${user.name} (${user.locale})`,
  staleTime: 30_000,
}

export const ConditionalUserQuery = ({
  rpcQuery,
  users,
}: {
  readonly rpcQuery: ViteReactApplication['rpcQuery']
  readonly users: readonly User[]
}) => {
  const [userId, setUserId] = useState('')
  const options = rpcQuery.users.get.queryOptions({
    ...displayOptions,
    input: userId === '' ? skipToken : { id: Number(userId) },
  })
  const user = useQuery(options)

  return (
    <section
      aria-label="Conditional user lookup"
      className="border border-border bg-background p-5"
    >
      <h3 className="display-heading text-xl font-bold text-text-primary">
        Choose before fetching
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        The query waits until you choose a user. Clear the selection to pause it again. Reselect the
        same user within 30 seconds to reuse the cached result.
      </p>
      <label className="mt-4 grid gap-2 text-sm font-bold text-brand-300">
        User to inspect
        <select
          className="border border-border-strong bg-muted p-2 text-text-primary"
          value={userId}
          onChange={(event) => {
            setUserId(event.target.value)
          }}
        >
          <option value="">No user selected</option>
          {users.map((entry) => (
            <option key={entry.id} value={entry.id}>
              User {entry.id}: {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div aria-live="polite" className="mt-4 text-sm text-text-secondary">
        {userId === '' ? <p>Choose a user to start the query.</p> : null}
        {user.isFetching ? <p>Loading selected user…</p> : null}
        {user.data === undefined ? null : <p>Selected user: {user.data}</p>}
      </div>
      {user.error === null ? null : <EffectErrorDetails error={user.error} />}
    </section>
  )
}

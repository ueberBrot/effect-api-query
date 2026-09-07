import { useMutation } from '@tanstack/react-query'
import { type SubmitEvent, useState } from 'react'

import type { ViteReactApplication } from '../../lib/application.ts'
import { ActionButton } from '../ui/action-button.tsx'
import { EffectErrorDetails } from '../ui/effect-error-details.tsx'

export const CreateUserForm = ({ application }: { readonly application: ViteReactApplication }) => {
  const { invalidateUsers, rpcQuery } = application
  const [locale, setLocale] = useState('')
  const [name, setName] = useState('')
  const createUser = useMutation(
    rpcQuery.users.create.mutationOptions({
      onSuccess: invalidateUsers,
    }),
  )

  const submitUser = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const userName = name.trim()
    const userLocale = locale.trim()
    if (userName.length === 0) return

    createUser.mutate(
      {
        name: userName,
        ...(userLocale.length === 0 ? {} : { locale: userLocale }),
      },
      {
        onSuccess: () => {
          setLocale('')
          setName('')
        },
      },
    )
  }

  return (
    <>
      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_auto] md:items-end"
        onSubmit={submitUser}
      >
        <label className="grid gap-1.5 text-sm font-semibold text-zinc-300">
          Name
          <input
            className="min-w-0 rounded-sm border border-zinc-700 bg-black px-3 py-2.5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            onChange={(event) => setName(event.currentTarget.value)}
            required
            value={name}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-zinc-300">
          Locale (optional)
          <input
            className="min-w-0 rounded-sm border border-zinc-700 bg-black px-3 py-2.5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            onChange={(event) => setLocale(event.currentTarget.value)}
            placeholder="en"
            value={locale}
          />
        </label>
        <ActionButton disabled={createUser.isPending} type="submit">
          {createUser.isPending ? 'Adding user...' : 'Add user'}
        </ActionButton>
      </form>
      {createUser.data === undefined ? null : (
        <p className="text-sm">Added {createUser.data.name}</p>
      )}
      <EffectErrorDetails error={createUser.error} />
    </>
  )
}

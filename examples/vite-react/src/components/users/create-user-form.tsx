import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import type { SubmitEvent } from 'react'

import type { ViteReactApplication } from '../../lib/application.ts'
import { ActionButton } from '../ui/action-button.tsx'
import { EffectErrorDetails } from '../ui/effect-error-details.tsx'

export const CreateUserForm = ({ application }: { readonly application: ViteReactApplication }) => {
  const { userWrites } = application
  const [locale, setLocale] = useState('')
  const [name, setName] = useState('')
  const createUser = useMutation(userWrites.rpcCreate())

  const submitUser = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const userName = name.trim()
    const userLocale = locale.trim()
    if (userName.length === 0) {
      return
    }

    const input =
      userLocale.length === 0 ? { name: userName } : { name: userName, locale: userLocale }
    createUser.mutate(input, {
      onSuccess: () => {
        setLocale('')
        setName('')
      },
    })
  }

  return (
    <>
      <form className="user-form-grid grid gap-3 md:items-end" onSubmit={submitUser}>
        <label className="grid gap-1.5 text-sm font-semibold text-text-tertiary">
          Name
          <input
            className="min-w-0 rounded-sm border border-border-strong bg-background px-3 py-2.5 text-text-primary outline-none placeholder:text-placeholder focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            onChange={(event) => {
              setName(event.currentTarget.value)
            }}
            required
            value={name}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-text-tertiary">
          Locale (optional)
          <input
            className="min-w-0 rounded-sm border border-border-strong bg-background px-3 py-2.5 text-text-primary outline-none placeholder:text-placeholder focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            onChange={(event) => {
              setLocale(event.currentTarget.value)
            }}
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

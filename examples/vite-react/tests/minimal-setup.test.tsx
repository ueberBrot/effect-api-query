// @vitest-environment jsdom

import { startExampleRpcServer } from '@effect-api-query/server'
import { act, screen } from '@testing-library/react'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { mountUsersApplication } from '../../../tests/types/docs-react-setup.tsx'

describe('minimal React setup recipe', () => {
  it('mounts a ready HTTP utility tree with its provider and releases the application after unmount', async () => {
    const scope = await Effect.runPromise(Scope.make())
    const element = document.createElement('div')
    document.body.append(element)
    let stop: (() => Promise<void>) | undefined
    try {
      const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(scope)))
      await act(async () => {
        stop = await mountUsersApplication(element, server.httpApiUrl)
      })
      await expect(screen.findByRole('heading', { name: 'Ada Lovelace' })).resolves.toBeDefined()
      await act(async () => {
        await stop?.()
      })
      stop = undefined
      expect(element.childElementCount).toBe(0)
    } finally {
      if (stop !== undefined) {
        await act(stop)
      }
      element.remove()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})

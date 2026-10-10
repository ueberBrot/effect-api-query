import { expect, test } from '@playwright/test'
import { Schema } from 'effect'
import { readFile } from 'node:fs/promises'

import { startPackedHostConsumer } from '../scripts/packed-host-consumer.mts'

const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf-8')
const current = /^ {2}['"]?@tanstack\/query-core['"]?: (?<version>\S+)$/mu.exec(workspace)
  ?.groups?.['version']
if (current === undefined) {
  throw new Error('The catalog must define Query Core')
}

const headerValue = Schema.Struct({
  body: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
})
const hostObservation = Schema.Struct({
  host: Schema.String,
  read: Schema.Finite,
  rpc: Schema.Struct({
    mutation: Schema.Finite,
    after: Schema.Finite,
    accumulated: Schema.Array(Schema.Finite),
    live: Schema.Finite,
  }),
  http: Schema.Struct({
    read: headerValue,
    mutation: Schema.Finite,
    after: headerValue,
    accumulated: Schema.Array(Schema.Finite),
    live: Schema.Finite,
    metadata: Schema.Struct({
      data: headerValue,
      status: Schema.Finite,
      owner: Schema.String,
      frozenSnapshot: Schema.Boolean,
      frozenHeaders: Schema.Boolean,
    }),
  }),
  skipIdentity: Schema.Array(Schema.Boolean),
  ownership: Schema.Struct({
    before: Schema.Array(Schema.Finite),
    activeBefore: Schema.Array(Schema.Finite),
    activeAfterFirst: Schema.Array(Schema.Finite),
    secondData: Schema.Array(Schema.Finite),
    activeAfterBoth: Schema.Array(Schema.Finite),
    firstEvents: Schema.Array(Schema.String),
    secondEvents: Schema.Array(Schema.String),
  }),
})
const decodeResult = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ window: hostObservation, worker: hostObservation })),
)

for (const peer of new Set(['5.103.1', current])) {
  test(`packed RPC and HTTP operations execute in window and worker with Query Core ${peer}`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const host = await startPackedHostConsumer(peer)
    try {
      await page.goto(host.url)
      await expect(page.locator('#result')).toHaveAttribute('data-status', 'done', {
        timeout: 30_000,
      })
      const result = decodeResult((await page.locator('#result').textContent()) ?? '')
      expect(result.window.host).toBe('Window')
      expect(result.worker.host).toBe('DedicatedWorkerGlobalScope')
      expect(result.window.read).toBe(10)
      expect(result.worker.read).toBe(10)
      for (const observation of [result.window, result.worker]) {
        expect(observation.rpc).toEqual({
          mutation: 41,
          after: 41,
          accumulated: [41, 42, 43],
          live: 43,
        })
        expect(observation.http).toEqual({
          read: { body: 10, headers: { 'x-owner': 'Ada' } },
          mutation: 52,
          after: { body: 52, headers: { 'x-owner': 'Ada' } },
          accumulated: [52, 53, 54],
          live: 54,
          metadata: {
            data: { body: 52, headers: { 'x-owner': 'Ada' } },
            status: 200,
            owner: 'Ada',
            frozenSnapshot: true,
            frozenHeaders: true,
          },
        })
        expect(observation.skipIdentity).toEqual([true, true, true])
        expect(observation.ownership.before).toEqual([20, 20])
        expect(observation.ownership.activeBefore).toEqual([2, 2])
        expect(observation.ownership.activeAfterFirst).toEqual([0, 2])
        expect(observation.ownership.secondData).toEqual([20, 20])
        expect(observation.ownership.activeAfterBoth).toEqual([0, 0])
        for (const [name, events] of [
          ['Ada', observation.ownership.firstEvents],
          ['Grace', observation.ownership.secondEvents],
        ] as const) {
          expect(events).toEqual(
            expect.arrayContaining([
              `${name}:rpc-finalized`,
              `${name}:http-finalized`,
              `${name}:disposed`,
            ]),
          )
          expect(events.at(-1)).toBe(`${name}:disposed`)
        }
      }
    } finally {
      await host.dispose()
    }
  })
}

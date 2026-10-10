import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Path } from 'effect'
// fallow-ignore-file unused-file
import { strictEqual } from 'node:assert'

import { decodeUtf8 } from './decode-utf8.mts'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const [page, fixtures] of [
    ['getting-started/quick-start', ['tests/types/docs-rpc-quick-start']],
    ['getting-started/http-quick-start', ['tests/types/docs-http-quick-start']],
    ['guides/retry-queries', ['tests/types/docs-retry']],
    ['guides/refresh-from-events', ['tests/types/docs-user-events']],
    [
      'guides/websocket-clients',
      ['tests/fixtures/socket-client', 'tests/fixtures/docs-websocket-use'],
    ],
    ['guides/stream-snapshots', ['tests/types/docs-stream-snapshot']],
    ['guides/hydrate-query-views', ['tests/types/docs-hydration-views']],
    [
      'guides/hydrate-unary-data',
      [
        'tests/types/docs-hydration-dto',
        'tests/types/docs-hydration-rich',
        'tests/types/docs-hydration-async',
      ],
    ],
  ] as const) {
    const markdown = decodeUtf8(
      yield* fs.readFile(
        yield* path.fromFileUrl(
          new URL(`../apps/docs/src/content/docs/${page}.md`, import.meta.url),
        ),
      ),
    )
    const samples = [...markdown.matchAll(/^```ts\n(?<source>[\s\S]*?)^```/gmu)]
    strictEqual(samples.length, fixtures.length, `${page} must contain its TypeScript fixtures`)
    for (const [index, fixture] of fixtures.entries()) {
      const source = decodeUtf8(
        yield* fs.readFile(yield* path.fromFileUrl(new URL(`../${fixture}.ts`, import.meta.url))),
      )
      strictEqual(
        samples[index]?.groups?.['source']?.trimEnd(),
        source
          .replaceAll("from '#effect-api-query'", "from 'effect-api-query'")
          .replaceAll("from '../fixtures/user-events.ts'", "from './user-events.ts'")
          .trimEnd(),
        `${page} differs from ${fixture}.ts`,
      )
    }
  }
})
NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))

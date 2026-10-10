import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Path } from 'effect'
// fallow-ignore-file unused-file
import { ok } from 'node:assert'

import { decodeUtf8 } from './decode-utf8.mts'

const unindent = (lines: readonly string[]) => {
  const indentation = Math.min(
    ...lines
      .filter((line) => line.trim().length > 0)
      .map((line) => /^ */u.exec(line)?.[0].length ?? 0),
  )
  return lines.map((line) => line.slice(indentation)).join('\n')
}

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
    ok(samples.length > 0, `${page} must contain a TypeScript excerpt`)
    const sources: string[][] = []
    for (const fixture of fixtures) {
      const source = decodeUtf8(
        yield* fs.readFile(yield* path.fromFileUrl(new URL(`../${fixture}.ts`, import.meta.url))),
      )
      sources.push(
        source
          .replaceAll("from '#effect-api-query'", "from 'effect-api-query'")
          .replaceAll("from '../fixtures/user-events.ts'", "from './user-events.ts'")
          .trimEnd()
          .split('\n'),
      )
    }
    for (const [index, sample] of samples.entries()) {
      const lines = sample.groups?.['source']?.trimEnd().split('\n') ?? []
      ok(
        lines.some((line) => line.trim().length > 0),
        `${page} excerpt ${index + 1} is empty`,
      )
      ok(
        sources.some((source) =>
          source.some(
            (_, start) => unindent(source.slice(start, start + lines.length)) === unindent(lines),
          ),
        ),
        `${page} excerpt ${index + 1} differs from its allowed fixtures`,
      )
    }
  }
})
NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))

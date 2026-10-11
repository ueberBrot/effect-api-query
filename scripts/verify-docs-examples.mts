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
    [
      'README.md',
      [
        'tests/types/docs-readme-rpc-contract',
        'tests/types/docs-readme-rpc',
        'tests/types/docs-readme-http-contract',
        'tests/types/docs-readme-http',
      ],
    ],
    [
      'getting-started/quick-start',
      ['tests/types/docs-rpc-quick-start-contract', 'tests/types/docs-rpc-quick-start'],
    ],
    [
      'getting-started/http-quick-start',
      ['tests/types/docs-http-quick-start-contract', 'tests/types/docs-http-quick-start'],
    ],
    [
      'guides/react-query',
      [
        'tests/types/docs-readme-http-contract',
        'tests/types/docs-react-client',
        'tests/types/docs-react-setup.tsx',
        'tests/types/docs-react-entry',
      ],
    ],
    ['guides/suspense-and-recovery', ['tests/types/docs-suspense.tsx']],
    [
      'guides/trace-streams',
      ['tests/types/docs-stream-tracing-contract', 'tests/types/docs-stream-tracing'],
    ],
    ['guides/query-defaults', ['tests/types/docs-policies']],
    ['reference/type-inference', ['tests/types/docs-policies']],
    ['guides/queries', ['tests/types/docs-functionality']],
    ['guides/mutations', ['tests/types/docs-functionality']],
    ['guides/pagination', ['tests/types/docs-functionality']],
    ['guides/streaming', ['tests/types/docs-functionality']],
    ['guides/http-metadata', ['tests/types/docs-functionality']],
    ['guides/http-queries-and-mutations', ['tests/types/docs-functionality']],
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
          new URL(
            page === 'README.md' ? '../README.md' : `../apps/docs/src/content/docs/${page}.md`,
            import.meta.url,
          ),
        ),
      ),
    )
    const samples = [...markdown.matchAll(/^```(?:ts|tsx)\n(?<source>[\s\S]*?)^```/gmu)]
    ok(samples.length > 0, `${page} must contain a TypeScript excerpt`)
    const sources: string[][] = []
    for (const fixture of fixtures) {
      const fixturePath = /\.tsx?$/u.test(fixture) ? fixture : `${fixture}.ts`
      const source = decodeUtf8(
        yield* fs.readFile(yield* path.fromFileUrl(new URL(`../${fixturePath}`, import.meta.url))),
      )
      sources.push(
        source
          .replaceAll("from '#effect-api-query'", "from 'effect-api-query'")
          .replaceAll("from './docs-readme-rpc-contract.ts'", "from './rpc-contract.ts'")
          .replaceAll("from './docs-readme-http-contract.ts'", "from './http-contract.ts'")
          .replaceAll("from './docs-rpc-quick-start-contract.ts'", "from './rpc-contract.ts'")
          .replaceAll("from './docs-http-quick-start-contract.ts'", "from './http-contract.ts'")
          .replaceAll("from './docs-react-client.ts'", "from './client.ts'")
          .replaceAll("from './docs-stream-tracing-contract.ts'", "from './feed-contract.ts'")
          .replaceAll("from './docs-react-setup.tsx'", "from './users-app.tsx'")
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

// fallow-ignore-file unused-file
// The docs-check task verifies tutorial text against packed compiler fixtures.
import { strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'

for (const [page, fixtures] of [
  ['getting-started/quick-start', ['types/docs-rpc-quick-start']],
  ['getting-started/http-quick-start', ['types/docs-http-quick-start']],
  ['guides/retry-queries', ['packed-consumer/docs-retry']],
  [
    'guides/cache-filters',
    ['packed-consumer/docs-cache-filters-rpc', 'packed-consumer/docs-cache-filters-http'],
  ],
  [
    'guides/hydrate-unary-data',
    [
      'packed-consumer/docs-hydration-dto',
      'packed-consumer/docs-hydration-rich',
      'packed-consumer/docs-hydration-async',
    ],
  ],
] as const) {
  const markdown = readFileSync(
    new URL(`../apps/docs/src/content/docs/${page}.md`, import.meta.url),
    'utf-8',
  )
  const samples = [...markdown.matchAll(/^```ts\n(?<source>[\s\S]*?)^```/gmu)]
  strictEqual(samples.length, fixtures.length, `${page} must contain its TypeScript fixtures`)
  for (const [index, fixture] of fixtures.entries()) {
    const source = readFileSync(new URL(`../tests/${fixture}.ts`, import.meta.url), 'utf-8')
    strictEqual(
      samples[index]?.groups?.['source']?.trimEnd(),
      source.trimEnd(),
      `${page} differs from ${fixture}.ts`,
    )
  }
}

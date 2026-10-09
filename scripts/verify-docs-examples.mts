// fallow-ignore-file unused-file
// The docs-check task verifies tutorial text against packed compiler fixtures.
import { strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'

for (const [page, fixture] of [
  ['getting-started/quick-start', 'types/docs-rpc-quick-start'],
  ['getting-started/http-quick-start', 'types/docs-http-quick-start'],
  ['guides/retry-queries', 'packed-consumer/docs-retry'],
]) {
  const markdown = readFileSync(
    new URL(`../apps/docs/src/content/docs/${page}.md`, import.meta.url),
    'utf-8',
  )
  const source = readFileSync(new URL(`../tests/${fixture}.ts`, import.meta.url), 'utf-8')
  const samples = [...markdown.matchAll(/^```ts\n(?<source>[\s\S]*?)^```/gmu)]
  strictEqual(samples.length, 1, `${page} must contain its complete TypeScript fixture`)
  strictEqual(
    samples[0]?.groups?.['source']?.trimEnd(),
    source.trimEnd(),
    `${page} differs from ${fixture}.ts`,
  )
}

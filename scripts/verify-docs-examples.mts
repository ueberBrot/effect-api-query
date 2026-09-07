// fallow-ignore-file unused-file
// The docs-check task verifies tutorial text against packed compiler fixtures.
import { strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'

for (const [page, fixture] of [
  ['quick-start', 'docs-rpc-quick-start'],
  ['http-quick-start', 'docs-http-quick-start'],
]) {
  const markdown = readFileSync(
    new URL(`../apps/docs/src/content/docs/getting-started/${page}.md`, import.meta.url),
    'utf8',
  )
  const source = readFileSync(new URL(`../tests/types/${fixture}.ts`, import.meta.url), 'utf8')
  const samples = [...markdown.matchAll(/^```ts\n([\s\S]*?)^```/gm)]
  strictEqual(samples.length, 1, `${page} must contain its complete TypeScript fixture`)
  strictEqual(samples[0]?.[1]?.trimEnd(), source.trimEnd(), `${page} differs from ${fixture}.ts`)
}

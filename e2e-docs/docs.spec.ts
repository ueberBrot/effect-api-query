import { expect, test } from '@playwright/test'

import packageManifest from '../package.json' with { type: 'json' }

const docsBase = '/effect-api-query/'
const registryUrl = 'https://registry.npmjs.org/effect-api-query/latest'
const packageUrl = 'https://www.npmjs.com/package/effect-api-query'
const repositoryUrl = 'https://github.com/ueberBrot/effect-api-query'

test('opens both tutorials and searches the production index under the public base', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin
  const failedAssets: string[] = []
  const loadedAssets: string[] = []
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin !== origin) return
    if (!response.ok()) failedAssets.push(`${response.status()} ${url.pathname}`)
    if (url.pathname.includes('/_astro/') || url.pathname.includes('/pagefind/')) {
      loadedAssets.push(url.pathname)
    }
  })
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === origin) failedAssets.push(request.url())
  })
  await page.route(registryUrl, (route) => route.fulfill({ status: 404, json: {} }))

  await page.goto(docsBase, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('effect-api-query')
  await page.getByRole('link', { name: 'RPC quick start', exact: true }).click()
  await expect(page).toHaveURL(`${docsBase}getting-started/quick-start/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RPC Quick Start')
  await page.waitForLoadState('networkidle')

  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', {
      name: 'HTTP Factory',
      exact: true,
    })
    .click()
  await expect(page).toHaveURL(`${docsBase}reference/http-factory/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HTTP Factory')
  await page.waitForLoadState('networkidle')

  await page.goto(docsBase, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'HTTP quick start', exact: true }).click()
  await expect(page).toHaveURL(`${docsBase}getting-started/http-quick-start/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HTTP Quick Start')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const search = page.getByRole('dialog', { name: 'Search', exact: true })
  await search.getByRole('textbox', { name: 'Search' }).fill('RPC Quick Start')
  const result = search.locator(`a[href$="${docsBase}getting-started/quick-start/"]`).first()
  await expect(result).toBeVisible()
  await result.click()
  await expect(page).toHaveURL(`${docsBase}getting-started/quick-start/`)
  await page.waitForLoadState('networkidle')

  expect(loadedAssets.some((path) => path.startsWith(`${docsBase}_astro/`))).toBe(true)
  expect(loadedAssets.some((path) => path.startsWith(`${docsBase}pagefind/`))).toBe(true)
  expect(failedAssets).toEqual([])
  expect(pageErrors).toEqual([])
})

test('uses canonical repository links and serves branded icons', async ({ page, request }) => {
  await page.route(registryUrl, (route) => route.fulfill({ status: 404, json: {} }))
  await page.goto(`${docsBase}getting-started/quick-start/`)
  await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute(
    'href',
    repositoryUrl,
  )
  await expect(page.getByRole('link', { name: 'Edit page', exact: true })).toHaveAttribute(
    'href',
    `${repositoryUrl}/edit/main/apps/docs/src/content/docs/getting-started/quick-start.md`,
  )
  await expect(
    page.getByRole('link', { name: 'tests/types/docs-rpc-quick-start.ts', exact: true }),
  ).toHaveAttribute('href', `${repositoryUrl}/blob/main/tests/types/docs-rpc-quick-start.ts`)

  const iconUrls = [
    await page.locator('link[rel="shortcut icon"]').getAttribute('href'),
    await page.locator('.site-title img').getAttribute('src'),
  ]
  for (const url of iconUrls) {
    expect(url).toMatch(/^\/effect-api-query\//)
    const response = await request.get(url!)
    expect(response.ok(), url!).toBe(true)
    expect(response.headers()['content-type']).toContain('image/svg+xml')
    expect(await response.text()).toMatch(/<title(?:\s[^>]*)?>effect-api-query<\/title>/)
  }
})

test('shows the latest published version from the package registry', async ({ page }) => {
  await page.route(registryUrl, (route) => route.fulfill({ json: { version: '1.2.3-beta.1' } }))
  await page.goto(docsBase)
  const links = page.locator(`a[href="${packageUrl}"]`)
  await expect(links.first()).toHaveText('v1.2.3-beta.1')
  for (const link of await links.all()) {
    await expect(link).toHaveText('v1.2.3-beta.1')
    await expect(link).toHaveAttribute('aria-label', 'effect-api-query v1.2.3-beta.1 on npm')
  }
})

for (const failure of ['unpublished package', 'network failure', 'invalid version'] as const) {
  test(`retains the build version after ${failure}`, async ({ page }) => {
    await page.route(registryUrl, (route) => {
      if (failure === 'network failure') return route.abort('failed')
      if (failure === 'unpublished package') return route.fulfill({ status: 404, json: {} })
      return route.fulfill({ json: { version: 'latest' } })
    })
    const request = page.waitForRequest(registryUrl)
    await page.goto(docsBase, { waitUntil: 'networkidle' })
    await request
    const links = page.locator(`a[href="${packageUrl}"]`)
    await expect(links.first()).toHaveText(`v${packageManifest.version}`)
    for (const link of await links.all()) {
      await expect(link).toHaveText(`v${packageManifest.version}`)
    }
  })
}

test('serves generated LLM documentation with the public URLs', async ({ request }) => {
  const linkedPaths = new Set<string>()
  const index = await request.get(`${docsBase}llms.txt`)
  expect(index.ok()).toBe(true)
  const indexText = await index.text()
  expect(indexText).toContain('# effect-api-query')
  for (const filename of ['llms-small.txt', 'llms-full.txt']) {
    expect(indexText).toContain(`https://ueberbrot.github.io${docsBase}${filename}`)
    const response = await request.get(`${docsBase}${filename}`)
    expect(response.ok()).toBe(true)
    const content = await response.text()
    expect(content).toContain('RPC Quick Start')
    expect(content).toContain('HTTP Quick Start')
    expect(content).toContain(`](${docsBase}getting-started/quick-start/)`)
    expect(content).not.toContain('](/effect-rpc-query/')
    for (const match of content.matchAll(/\]\((\/effect-api-query\/[^)\s]*)\)/g)) {
      linkedPaths.add(match[1]!.split('#')[0]!)
    }
  }
  expect(linkedPaths.size).toBeGreaterThan(0)
  await Promise.all(
    [...linkedPaths].map(async (path) => {
      const response = await request.get(path)
      expect(response.ok(), path).toBe(true)
      expect(response.headers()['content-type'], path).toContain('text/html')
    }),
  )
})

import { expect, test } from '@playwright/test'
import { createServer, request as nodeRequest } from 'node:http'

import {
  prepareExampleApplication,
  recordsRpc,
  tanStackStartApplication,
} from './example-application.ts'

test('Start rejects an oversized upload before the sender ends the request', async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = nodeRequest(
      `${tanStackStartApplication.url}/rpc`,
      { method: 'POST' },
      (response) => {
        response.resume()
        response.once('end', () => {
          request.destroy()
          resolve(response.statusCode)
        })
      },
    )
    request.once('error', reject)
    request.setTimeout(1000, () => request.destroy(new Error('Request timed out')))
    request.write(' '.repeat(1024 * 1024 + 1))
  })
  expect(status).toBe(413)
})

test('SSR keeps its RPC destination independent of incoming host headers', async ({ request }) => {
  let redirectedRequests = 0
  const destination = createServer((_request, response) => {
    redirectedRequests += 1
    response.writeHead(500).end()
  })
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve))
  try {
    const address = destination.address()
    if (address === null || typeof address === 'string') throw new Error('Expected TCP listener')
    const host = `127.0.0.1:${String(address.port)}`
    const response = await request.get(`${tanStackStartApplication.url}/details`, {
      headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'http' },
    })
    expect(redirectedRequests).toBe(0)
    expect(response.ok()).toBe(true)
    expect(await response.text()).toContain('Ada Lovelace')
  } finally {
    destination.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      destination.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test.describe('TanStack Start application', () => {
  test.beforeEach(async ({ page }) => prepareExampleApplication(page, tanStackStartApplication))

  test('server-renders and hydrates without a duplicate successful query', async ({
    browser,
    page,
  }) => {
    const serverRenderedContext = await browser.newContext({ javaScriptEnabled: false })
    try {
      const serverRenderedPage = await serverRenderedContext.newPage()
      const serverRenderedResponse = await serverRenderedPage.goto(tanStackStartApplication.url)

      expect(serverRenderedResponse?.ok()).toBe(true)
      await expect(serverRenderedPage.getByText('Ada Lovelace', { exact: true })).toBeVisible()
      await expect(serverRenderedPage.getByText('Edsger Dijkstra', { exact: true })).toBeVisible()
      await expect(serverRenderedPage.getByText('Connection opened', { exact: true })).toBeVisible()
      await expect(serverRenderedPage.getByText('Current state: Connection opened')).toBeVisible()
    } finally {
      await serverRenderedContext.close()
    }

    let browserListRequests = 0
    page.on('request', (request) => {
      if (recordsRpc(request.postData(), 'users.list')) browserListRequests += 1
    })

    const response = await page.reload()

    expect(response?.ok()).toBe(true)
    await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
    await expect(page.getByText('Edsger Dijkstra', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Read cached directory' }).click()
    await expect(page.getByText('Cached directory: 12 users')).toBeVisible()
    expect(browserListRequests).toBe(0)
  })

  test('hydrates stream snapshots and refetches their remaining values', async ({ page }) => {
    await expect(page.getByText('4 updates retained')).toBeVisible()
    await expect(page.getByText('Current state: Ready')).toBeVisible()

    const history = page.getByRole('region', { name: 'Accumulated stream history' })
    await page.getByRole('button', { name: 'Replay newest 2' }).click()
    await expect(history.getByRole('listitem')).toHaveText([/Workspace synchronized$/, /Ready$/])
    await expect(page.getByText('2 updates retained')).toBeVisible()
    await expect(page.getByText('Current state: Ready')).toBeVisible()

    await page.getByRole('button', { name: 'Replay full history' }).click()
    await expect(page.getByText('4 updates retained')).toBeVisible()
    await expect(history.getByRole('listitem')).toHaveCount(4)
  })

  test('navigates on the client and reuses the hydrated cache', async ({ page }) => {
    await page.getByRole('link', { name: 'Featured user' }).click()
    await expect(page.getByRole('heading', { name: 'Featured user' })).toBeVisible()
    await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Users', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Compare full queries, pages, and streams' }),
    ).toBeVisible()
    let browserListRequests = 0
    page.on('request', (request) => {
      if (recordsRpc(request.postData(), 'users.list')) browserListRequests += 1
    })
    await page.getByRole('button', { name: 'Read cached directory' }).click()
    await expect(page.getByText('Cached directory: 12 users')).toBeVisible()
    expect(browserListRequests).toBe(0)
  })

  test('hydrates and advances an infinite query', async ({ page }) => {
    await expect(page.getByText('4 of 12 loaded')).toBeVisible()
    await expect(page.getByText('Page 1: 4 users')).toBeVisible()

    const nextPageResponse = page.waitForResponse(
      (response) => response.ok() && recordsRpc(response.request().postData(), 'users.page'),
    )
    await page.getByRole('button', { name: 'Load next 4 users' }).click()
    const rpcResponse = await nextPageResponse

    const rpcUrl = new URL(rpcResponse.url())
    expect(rpcResponse.request().method()).toBe('POST')
    expect(rpcUrl.origin).toBe(new URL(tanStackStartApplication.url).origin)
    expect(rpcUrl.pathname).toBe('/rpc/')

    await expect(page.getByText('Page 2: 4 users')).toBeVisible()
    await expect(page.getByText('8 of 12 loaded')).toBeVisible()
  })

  test('mutates and invalidates the hydrated users query', async ({ page }) => {
    const listResponse = page.waitForResponse(
      (response) => response.ok() && recordsRpc(response.request().postData(), 'users.list'),
    )
    await page.getByRole('button', { name: 'Add Grace Hopper' }).click()
    await listResponse

    await expect(page.getByText('Grace Hopper', { exact: true })).toBeVisible()
    await expect(page.getByText('13 users in one response')).toBeVisible()
  })

  test('shows declared failures and externally visible cancellation', async ({ page }) => {
    await page.getByRole('link', { name: 'Diagnostics' }).click()
    await expect(page.getByRole('heading', { name: 'Failures and cancellation' })).toBeVisible()

    await page.getByRole('button', { name: 'Trigger declared failure' }).click()
    const failure = page.getByRole('alert')
    await expect(failure).toContainText('EffectRpcQueryError')
    await expect(failure).toContainText('DiagnosticFailure')

    await page.getByRole('button', { name: 'Start slow query' }).click()
    await expect(page.getByText('Ready to cancel')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel query' }).click()
    await expect(page.getByText('Server interruptions: 1')).toBeVisible()
  })
})

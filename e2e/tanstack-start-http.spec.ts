import { expect, test } from '@playwright/test'

import {
  isHttpRequest,
  prepareExampleApplication,
  recordsRpc,
  tanStackStartApplication,
} from './example-application.ts'

const httpUrl = `${tanStackStartApplication.url}/http`

test.describe('TanStack Start HTTP API example', () => {
  test.beforeEach(async ({ page }) => {
    await prepareExampleApplication(page, tanStackStartApplication)
    await page.goto(httpUrl)
    await expect(page.getByRole('heading', { name: 'HTTP users', exact: true })).toBeVisible()
  })

  test('server-renders HTTP data and hydrates both query shapes without duplicate requests', async ({
    browser,
    page,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const serverPage = await context.newPage()
      const response = await serverPage.goto(httpUrl)
      expect(response?.ok()).toBe(true)
      await expect(serverPage.getByText('HTTP: Ada Lovelace', { exact: true })).toBeVisible()
      await expect(serverPage.getByText('HTTP page 1: 4 users')).toBeVisible()
      await expect(serverPage.getByText('HTTP: 4 of 12 loaded')).toBeVisible()
    } finally {
      await context.close()
    }

    const requests: string[] = []
    page.on('request', (request) => {
      if (isHttpRequest(request, 'GET', '/users') || isHttpRequest(request, 'GET', '/users/page'))
        requests.push(request.url())
    })
    await page.reload()
    await page.getByRole('button', { name: 'Read cached HTTP directory' }).click()
    await expect(page.getByText('HTTP cached directory: 12 users')).toBeVisible()
    await expect(page.getByText('HTTP page 1: 4 users')).toBeVisible()
    expect(requests).toEqual([])

    await page.getByRole('link', { name: 'Featured user', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Featured user', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'HTTP users', exact: true }).click()
    await expect(page.getByText('HTTP: Ada Lovelace', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Read cached HTTP directory' }).click()
    await expect(page.getByText('HTTP cached directory: 12 users')).toBeVisible()
    expect(requests).toEqual([])
  })

  test('skips empty selections and reuses a selected HTTP user', async ({ page }) => {
    let lookups = 0
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        /\/api\/users\/\d+$/.test(new URL(request.url()).pathname)
      ) {
        lookups += 1
      }
    })
    await page.reload()
    await expect(page.getByText('HTTP user query skipped')).toBeVisible()
    expect(lookups).toBe(0)
    const selection = page.getByLabel('HTTP user details')
    await selection.selectOption('2')
    await expect(page.getByText('HTTP selected: Edsger Dijkstra, locale fr')).toBeVisible()
    expect(lookups).toBe(1)
    await selection.selectOption('')
    await expect(page.getByText('HTTP user query skipped')).toBeVisible()
    await expect(page.getByText('HTTP selected: Edsger Dijkstra, locale fr')).toHaveCount(0)
    await selection.selectOption('2')
    await expect(page.getByText('HTTP selected: Edsger Dijkstra, locale fr')).toBeVisible()
    expect(lookups).toBe(1)
  })

  test('advances the hydrated HTTP page through the same-origin host', async ({ page }) => {
    const nextPage = page.waitForResponse(
      (response) => response.ok() && isHttpRequest(response.request(), 'GET', '/users/page'),
    )
    await page.getByRole('button', { name: 'Load next HTTP page' }).click()
    const response = await nextPage
    const url = new URL(response.url())
    expect(url.origin).toBe(new URL(httpUrl).origin)
    expect(url.searchParams.get('cursor')).toBe('4')
    await expect(page.getByText('HTTP page 1: 4 users')).toBeVisible()
    await expect(page.getByText('HTTP page 2: 4 users')).toBeVisible()
    await expect(page.getByText('HTTP: 8 of 12 loaded')).toBeVisible()
  })

  test('mutates and invalidates the hydrated HTTP directory', async ({ page }) => {
    const refreshed = page.waitForResponse(
      (response) => response.ok() && isHttpRequest(response.request(), 'GET', '/users'),
    )
    await page.getByLabel('HTTP name', { exact: true }).fill('Start pioneer')
    await page.getByRole('button', { name: 'Add HTTP user', exact: true }).click()
    await refreshed
    await expect(page.getByText('HTTP: Start pioneer', { exact: true })).toBeVisible()

    const invalidated = page.waitForResponse(
      (response) => response.ok() && isHttpRequest(response.request(), 'GET', '/users'),
    )
    await page.getByRole('button', { name: 'Invalidate HTTP user queries' }).click()
    await invalidated

    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/api\/users\/\d+$/.test(new URL(response.url()).pathname),
    )
    await page.getByRole('button', { name: 'Delete HTTP Start pioneer', exact: true }).click()
    expect((await deletion).status()).toBe(204)
    await expect(page.getByText('HTTP delete result: undefined')).toBeVisible()
    await expect(page.getByText('HTTP: Start pioneer', { exact: true })).toHaveCount(0)
  })

  test('renders HTTP failure metadata and cancels the server operation', async ({ page }) => {
    await page.getByRole('button', { name: 'Trigger HTTP declared failure' }).click()
    const failure = page.getByRole('alert')
    await expect(failure).toContainText('EffectHttpApiQueryError')
    await expect(failure).toContainText('diagnostics')
    await expect(failure).toContainText('fail')
    await expect(failure).toContainText('DiagnosticFailure')
    await expect(failure).toContainText('requested-failure')

    const started = page.waitForRequest((request) =>
      isHttpRequest(request, 'GET', '/diagnostics/slow'),
    )
    await page.getByRole('button', { name: 'Start slow HTTP query' }).click()
    const request = await started
    await expect(page.getByText('HTTP: Ready to cancel')).toBeVisible()
    const aborted = page.waitForEvent('requestfailed', (failed) => failed === request)
    await page.getByRole('button', { name: 'Cancel HTTP query' }).click()
    await aborted
    expect(request.failure()).not.toBeNull()
    await expect(page.getByText('HTTP: Server interruptions: 1')).toBeVisible()
  })

  for (const transport of ['http', 'rpc'] as const) {
    test(`navigation cancels the pending ${transport.toUpperCase()} operation and stops status requests`, async ({
      page,
    }) => {
      if (transport === 'rpc') {
        await page.getByRole('link', { name: 'Diagnostics', exact: true }).click()
      }
      let statusRequests = 0
      page.on('request', (request) => {
        if (
          new URL(request.url()).pathname.startsWith('/api/diagnostics/operations/') ||
          recordsRpc(request.postData(), 'diagnostics.operationStatus')
        )
          statusRequests += 1
      })
      const started = page.waitForRequest((request) =>
        transport === 'http'
          ? isHttpRequest(request, 'GET', '/diagnostics/slow')
          : recordsRpc(request.postData(), 'diagnostics.slow'),
      )
      await page
        .getByRole('button', {
          name: transport === 'http' ? 'Start slow HTTP query' : 'Start slow query',
          exact: true,
        })
        .click()
      const request = await started
      const operationId =
        transport === 'http'
          ? new URL(request.url()).searchParams.get('operationId')
          : /"operationId"\s*:\s*"([^"]+)"/.exec(request.postData() ?? '')?.[1]
      expect(operationId).toBeTruthy()
      await expect(
        page.getByText(transport === 'http' ? 'HTTP: Ready to cancel' : 'Ready to cancel', {
          exact: true,
        }),
      ).toBeVisible()
      expect(statusRequests).toBeGreaterThan(0)

      const aborted = page.waitForEvent('requestfailed', (failed) => failed === request)
      await page.getByRole('link', { name: 'Featured user', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Featured user', exact: true })).toBeVisible()
      await aborted
      const requestsAfterNavigation = statusRequests
      const statusUrl = `${tanStackStartApplication.url}/api/diagnostics/operations/${encodeURIComponent(operationId!)}`
      await expect
        .poll(async () => {
          const response = await page.request.get(statusUrl)
          expect(response.ok()).toBe(true)
          return response.json()
        })
        .toEqual({ started: 1, interrupted: 1 })
      expect(statusRequests).toBe(requestsAfterNavigation)
    })
  }

  test('omits a failed server query and refetches it in the browser', async ({ browser, page }) => {
    const url = `${tanStackStartApplication.url}/http-failure`
    const context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const serverPage = await context.newPage()
      const response = await serverPage.goto(url)
      expect(response?.ok()).toBe(true)
      await expect(
        serverPage.getByRole('heading', { name: 'Refetch failed HTTP queries' }),
      ).toBeVisible()
      await expect(serverPage.getByText('Refetching in the browser…')).toBeVisible()
      await expect(serverPage.getByRole('alert')).toHaveCount(0)
      expect(await serverPage.content()).not.toContain('requested-failure')
    } finally {
      await context.close()
    }

    let failures = 0
    page.on('request', (request) => {
      if (isHttpRequest(request, 'GET', '/diagnostics/fail')) failures += 1
    })
    await page.goto(url)
    const failure = page.getByRole('alert')
    await expect(failure).toContainText('EffectHttpApiQueryError from diagnostics.fail (query)')
    await expect(failure).toContainText('DiagnosticFailure')
    expect(failures).toBe(1)
  })
})

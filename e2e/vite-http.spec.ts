import { expect, test, type Request } from '@playwright/test'

import {
  prepareExampleApplication,
  recordsRpc,
  viteReactApplication,
} from './example-application.ts'

const isHttpRequest = (request: Request, method: string, pathname: string): boolean =>
  request.method() === method && new URL(request.url()).pathname === `/api${pathname}`

test.describe('Vite React HTTP API example', () => {
  test.beforeEach(async ({ page }) => prepareExampleApplication(page, viteReactApplication))

  test('reuses the HTTP directory cache and skips an unselected user query', async ({ page }) => {
    const http = page.getByRole('region', { name: 'HTTP API example' })
    let listRequests = 0
    let lookupRequests = 0
    page.on('request', (request) => {
      if (isHttpRequest(request, 'GET', '/users')) listRequests += 1
      if (
        request.method() === 'GET' &&
        /\/api\/users\/\d+$/.test(new URL(request.url()).pathname)
      ) {
        lookupRequests += 1
      }
    })
    await page.reload()
    await expect(http.getByText('HTTP: Ada Lovelace', { exact: true })).toBeVisible()
    await expect(http.getByText('HTTP user query skipped')).toBeVisible()
    listRequests = 0
    await http.getByRole('button', { name: 'Read cached HTTP directory' }).click()
    await expect(http.getByText('HTTP cached directory: 12 users')).toBeVisible()
    expect(listRequests).toBe(0)
    expect(lookupRequests).toBe(0)

    const selection = http.getByLabel('HTTP user details')
    const lookup = page.waitForRequest((request) => isHttpRequest(request, 'GET', '/users/2'))
    await selection.selectOption('2')
    expect(new URL((await lookup).url()).searchParams.get('locale')).toBe('fr')
    await expect(http.getByText('HTTP selected: Edsger Dijkstra, locale fr')).toBeVisible()
    expect(lookupRequests).toBe(1)
    await selection.selectOption('')
    await expect(http.getByText('HTTP user query skipped')).toBeVisible()
    await expect(http.getByText('HTTP selected: Edsger Dijkstra, locale fr')).toHaveCount(0)
    await selection.selectOption('2')
    await expect(http.getByText('HTTP selected: Edsger Dijkstra, locale fr')).toBeVisible()
    expect(lookupRequests).toBe(1)
  })

  test('shares mutations across adapters and decodes an HTTP no-content deletion', async ({
    page,
  }) => {
    const http = page.getByRole('region', { name: 'HTTP API example' })
    await expect(http.getByText('HTTP: Ada Lovelace', { exact: true })).toBeVisible()
    await http.getByLabel('HTTP name', { exact: true }).fill('HTTP pioneer')
    await http.getByRole('button', { name: 'Add HTTP user', exact: true }).click()
    await expect(http.getByText('HTTP added HTTP pioneer', { exact: true })).toBeVisible()
    await expect(page.getByText('HTTP pioneer', { exact: true })).toBeVisible()
    await expect(http.getByText('HTTP: HTTP pioneer', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Delete HTTP pioneer', exact: true }).click()
    await expect(page.getByText('HTTP pioneer', { exact: true })).toHaveCount(0)
    await expect(http.getByText('HTTP: HTTP pioneer', { exact: true })).toHaveCount(0)

    await page.getByLabel('Name', { exact: true }).fill('RPC pioneer')
    await page.getByRole('button', { name: 'Add user', exact: true }).click()
    await expect(page.getByText('RPC pioneer', { exact: true })).toBeVisible()
    await expect(http.getByText('HTTP: RPC pioneer', { exact: true })).toBeVisible()

    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/api\/users\/\d+$/.test(new URL(response.url()).pathname),
    )
    await http.getByRole('button', { name: 'Delete HTTP RPC pioneer', exact: true }).click()
    const response = await deletion
    expect(response.status()).toBe(204)
    expect(await response.text()).toBe('')
    await expect(http.getByText('HTTP delete result: undefined')).toBeVisible()
    await expect(page.getByText('RPC pioneer', { exact: true })).toHaveCount(0)
    await expect(http.getByText('HTTP: RPC pioneer', { exact: true })).toHaveCount(0)

    const refreshedHttp = page.waitForResponse(
      (response) => response.ok() && isHttpRequest(response.request(), 'GET', '/users'),
    )
    const refreshedRpc = page.waitForResponse(
      (response) => response.ok() && recordsRpc(response.request().postData(), 'users.list'),
    )
    await http.getByRole('button', { name: 'Invalidate HTTP user queries' }).click()
    await Promise.all([refreshedHttp, refreshedRpc])
    await expect(
      http.getByText('HTTP and RPC user queries invalidated and refetched'),
    ).toBeVisible()
  })

  test('accumulates HTTP pages with distinct cursors', async ({ page }) => {
    const http = page.getByRole('region', { name: 'HTTP API example' })
    await expect(http.getByText('HTTP: 4 of 12 loaded')).toBeVisible()
    await expect(http.getByText('HTTP page 1: 4 users')).toBeVisible()

    const nextPage = page.waitForResponse(
      (response) => response.ok() && isHttpRequest(response.request(), 'GET', '/users/page'),
    )
    await http.getByRole('button', { name: 'Load next HTTP page' }).click()
    const response = await nextPage
    expect(new URL(response.url()).searchParams.get('cursor')).toBe('4')
    await expect(http.getByText('HTTP page 1: 4 users')).toBeVisible()
    await expect(http.getByText('HTTP page 2: 4 users')).toBeVisible()
    await expect(http.getByText('HTTP: 8 of 12 loaded')).toBeVisible()
  })

  test('renders the declared HTTP failure', async ({ page }) => {
    const http = page.getByRole('region', { name: 'HTTP API example' })
    await http.getByRole('button', { name: 'Trigger HTTP declared failure' }).click()
    const failure = http.getByRole('alert')
    await expect(failure).toContainText('EffectHttpApiQueryError')
    await expect(failure).toContainText('diagnostics')
    await expect(failure).toContainText('fail')
    await expect(failure).toContainText('DiagnosticFailure')
    await expect(failure).toContainText('requested-failure')
  })

  test('aborts the HTTP request and observes server interruption', async ({ page }) => {
    const http = page.getByRole('region', { name: 'HTTP API example' })
    const started = page.waitForRequest((request) =>
      isHttpRequest(request, 'GET', '/diagnostics/slow'),
    )
    await http.getByRole('button', { name: 'Start slow HTTP query' }).click()
    const request = await started
    await expect(http.getByText('HTTP: Ready to cancel')).toBeVisible()
    const aborted = page.waitForEvent('requestfailed', (failed) => failed === request)
    await http.getByRole('button', { name: 'Cancel HTTP query' }).click()
    await aborted
    expect(request.failure()).not.toBeNull()
    await expect(http.getByText('HTTP: Server interruptions: 1')).toBeVisible()
  })
})

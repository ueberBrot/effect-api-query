import { expect, test } from '@playwright/test'

import {
  prepareExampleApplication,
  recordsRpc,
  viteReactApplication,
} from './example-application.ts'

test.describe('plain Vite React application', () => {
  test.beforeEach(async ({ page }) => prepareExampleApplication(page, viteReactApplication))

  test('loads the initial query, reuses its cache, and survives reload', async ({ page }) => {
    await expect(page.getByText('Edsger Dijkstra', { exact: true })).toBeVisible()
    await expect(page.getByText('Featured: Ada Lovelace')).toBeVisible()

    let listRequests = 0
    page.on('request', (request) => {
      if (recordsRpc(request.postData(), 'users.list')) listRequests += 1
    })
    await page.getByRole('button', { name: 'Read cached directory' }).click()
    await expect(page.getByText('Cached directory: 12 users')).toBeVisible()
    expect(listRequests).toBe(0)

    await page.reload()
    await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
  })

  test('loads and accumulates infinite-query pages', async ({ page }) => {
    await expect(page.getByText('4 of 12 loaded', { exact: true })).toBeVisible()
    await expect(page.getByText('Page 1: 4 users', { exact: true })).toBeVisible()

    const nextPageResponse = page.waitForResponse(
      (response) => response.ok() && recordsRpc(response.request().postData(), 'users.page'),
    )
    await page.getByRole('button', { name: 'Load next 4 users' }).click()
    await nextPageResponse

    await expect(page.getByText('Page 2: 4 users', { exact: true })).toBeVisible()
    await expect(page.getByText('8 of 12 loaded', { exact: true })).toBeVisible()
  })

  test('renders accumulated and live stream values', async ({ page }) => {
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

  test('mutates users and explicitly invalidates through generated keys', async ({ page }) => {
    await page.getByRole('button', { name: 'Replace with eight pioneers' }).click()
    await expect(page.getByText('Grace Hopper', { exact: true })).toBeVisible()
    await expect(page.getByText('Margaret Hamilton', { exact: true })).toBeVisible()
    await expect(page.getByText('8 users in one response')).toBeVisible()

    const listResponse = page.waitForResponse(
      (response) => response.ok() && recordsRpc(response.request().postData(), 'users.list'),
    )
    await page.getByRole('button', { name: 'Invalidate user queries' }).click()
    await listResponse
    await expect(page.getByText('Directory queries invalidated and refetched')).toBeVisible()
  })

  test('renders the complete declared failure', async ({ page }) => {
    await page.getByRole('button', { name: 'Trigger declared failure' }).click()

    const failure = page.getByRole('alert')
    await expect(failure).toContainText('EffectRpcQueryError')
    await expect(failure).toContainText('diagnostics.fail')
    await expect(failure).toContainText('DiagnosticFailure')
  })

  test('cancels a query and observes server interruption', async ({ page }) => {
    await page.getByRole('button', { name: 'Start slow query' }).click()
    await expect(page.getByText('Ready to cancel')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel query' }).click()
    await expect(page.getByText('Server interruptions: 1')).toBeVisible()
  })

  test('cancels a pending command and reconciles progress without stopping another command', async ({
    page,
  }) => {
    const first = page.getByRole('region', { name: 'Command 1', exact: true })
    const second = page.getByRole('region', { name: 'Command 2', exact: true })
    await first.getByRole('button', { name: 'Start command' }).click()
    await second.getByRole('button', { name: 'Start command' }).click()
    await expect(first.getByText('Server state: running')).toBeVisible()
    await expect(first.getByText(/^Progress: [1-9]\d* \/ 40$/)).toBeVisible()
    await expect(first.getByText('Start mutation: pending')).toBeVisible()
    await first.getByRole('button', { name: 'Cancel command' }).click()
    await expect(first.getByText('Cancel mutation: success')).toBeVisible()
    await expect(first.getByText('Start mutation: success')).toBeVisible()
    await expect(first.getByText('Server state: cancelled')).toBeVisible()
    const stoppedProgress = await first.getByText(/^Progress:/).textContent()
    await expect(second.getByText('Server state: completed')).toBeVisible()
    await expect(second.getByText('Progress: 40 / 40')).toBeVisible()
    await expect(first.getByText(/^Progress:/)).toHaveText(stoppedProgress!)
  })
})

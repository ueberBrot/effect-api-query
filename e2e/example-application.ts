import { expect, type Page, type Request } from '@playwright/test'

export interface ExampleApplication {
  readonly heading: string
  readonly url: string
}

export const tanStackStartApplication = {
  heading: 'Compare full queries, pages, and streams',
  url: 'http://127.0.0.1:3000',
} satisfies ExampleApplication

export const viteReactApplication = {
  heading: 'Compare full queries, pages, and streams',
  url: 'http://127.0.0.1:4173',
} satisfies ExampleApplication

/** Establishes deterministic server state through the same controls a user exercises. */
export const prepareExampleApplication = async (
  page: Page,
  application: ExampleApplication,
): Promise<void> => {
  await page.goto(application.url)
  await expect(page.getByRole('heading', { name: application.heading })).toBeVisible()
  await page.getByRole('button', { name: 'Reset directory' }).click()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
}

export const recordsRpc = (postData: string | null, rpcTag: string): boolean =>
  postData?.includes(rpcTag) ?? false

export const isHttpRequest = (request: Request, method: string, pathname: string): boolean =>
  request.method() === method && new URL(request.url()).pathname === `/api${pathname}`

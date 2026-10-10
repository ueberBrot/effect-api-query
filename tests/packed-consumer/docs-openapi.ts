import createClient from 'openapi-fetch'

import type { paths } from './openapi-generated.ts'

const external = createClient<paths>({ baseUrl: 'https://api.example.test' })
const report = await external.POST('/reports/{id}', {
  params: {
    path: { id: '5' },
    query: { limit: '2', labels: ['a b', 'c+d'] },
    header: { 'x-factor': '3' },
  },
  body: { amount: '7', title: 'Quarter 1' },
})
if (report.error) {
  throw new Error(`Report failed with HTTP ${report.response.status}`)
}
const revision = report.response.headers.get('x-revision')

const uploaded = await external.POST('/reports/{id}/files', {
  params: {
    path: { id: '5' },
    query: { revision: '3' },
    header: { 'x-kind': 'document' },
  },
  body: { title: 'Notes', file: new File(['contents'], 'notes.txt') },
  bodySerializer: (body) => {
    const form = new FormData()
    form.set('title', body.title)
    form.set('file', body.file)
    return form
  },
})
const events = await external.GET('/reports/events/{channel}', {
  params: { path: { channel: 'values' } },
  parseAs: 'stream',
})
export { events, report, revision, uploaded }

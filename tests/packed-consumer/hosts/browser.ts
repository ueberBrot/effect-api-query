import { runHostOperations } from './runtime.ts'

const output = document.querySelector('#result')
if (output === null) throw new Error('The host consumer requires its result element')
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const workerResult = new Promise((resolve, reject) => {
  worker.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (event.data.error !== undefined) reject(new Error(event.data.error))
      else resolve(event.data)
    },
    { once: true },
  )
  worker.addEventListener('error', reject, { once: true })
})
try {
  const [window, workerData] = await Promise.all([runHostOperations(), workerResult])
  output.textContent = JSON.stringify({ window, worker: workerData })
  output.setAttribute('data-status', 'done')
} catch (error) {
  output.textContent = String(error)
  output.setAttribute('data-status', 'error')
} finally {
  worker.terminate()
}

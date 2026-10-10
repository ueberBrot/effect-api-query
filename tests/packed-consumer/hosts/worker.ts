import { runHostOperations } from './runtime.ts'

try {
  globalThis.postMessage(await runHostOperations())
} catch (error) {
  globalThis.postMessage({ error: String(error) })
}

import {
  exerciseSocketConcurrency,
  exerciseSocketInterruption,
  exerciseSocketReplacement,
} from './websocket-checks.ts'

await exerciseSocketConcurrency()
await exerciseSocketInterruption()
await exerciseSocketReplacement()

console.log(
  'Packed WebSocket concurrent queries, wire Causes, remote cancellation, and owner replacement executed',
)

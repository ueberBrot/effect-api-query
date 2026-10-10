import { Effect, Stdio, Stream } from 'effect'
import { ChildProcess } from 'effect/process'

import { decodeUtf8 } from './decode-utf8.mts'

interface CommandOptions {
  readonly cwd?: string
  readonly maxBuffer?: number
  readonly stdio?: 'inherit'
}

export const runCommand = Effect.fnUntraced(function* (
  executable: string,
  args: readonly string[],
  options: CommandOptions = {},
) {
  const handle = yield* ChildProcess.make(executable, args, {
    cwd: options.cwd,
    stdin: options.stdio === 'inherit' ? 'inherit' : 'ignore',
    stdout: options.stdio === 'inherit' ? 'inherit' : 'pipe',
    stderr: options.stdio === 'inherit' ? 'inherit' : 'pipe',
    forceKillAfter: '1 second',
  })
  if (options.stdio === 'inherit') {
    const code = yield* handle.exitCode
    if (code !== 0) {
      return yield* Effect.die(new Error(`${executable} exited with ${code}`))
    }
    return ''
  }
  const stdio = yield* Stdio.Stdio
  const maxBuffer = options.maxBuffer ?? 1024 * 1024
  let capturedBytes = 0
  const stderrChunks: Uint8Array[] = []
  const stderrOutput = { bytes: 0, chunks: stderrChunks }
  const decodeOutput = (output: typeof stderrOutput) => {
    const bytes = new Uint8Array(output.bytes)
    let offset = 0
    for (const chunk of output.chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return decodeUtf8(bytes)
  }
  const collect = (stream: typeof handle.stdout, initial?: typeof stderrOutput) =>
    stream.pipe(
      Stream.runFoldEffect(
        () => {
          const chunks: Uint8Array[] = []
          return initial ?? { bytes: 0, chunks }
        },
        (output, chunk) => {
          const captured = chunk.subarray(0, Math.max(0, maxBuffer - capturedBytes))
          capturedBytes += captured.byteLength
          output.bytes += captured.byteLength
          output.chunks.push(captured)
          if (captured.byteLength < chunk.byteLength) {
            return Effect.die(new Error(`${executable} output exceeded ${maxBuffer} bytes`))
          }
          return Effect.succeed(output)
        },
      ),
      Effect.map(decodeOutput),
    )
  const [stdout, stderr, code] = yield* Effect.all(
    [collect(handle.stdout), collect(handle.stderr, stderrOutput), handle.exitCode],
    { concurrency: 'unbounded' },
  ).pipe(
    Effect.onExit(() =>
      stderrOutput.bytes === 0
        ? Effect.void
        : Stream.succeed(decodeOutput(stderrOutput)).pipe(
            Stream.run(stdio.stderr({ endOnDone: false })),
          ),
    ),
  )
  if (code !== 0) {
    return yield* Effect.die(new Error(`${executable} exited with ${code}\n${stdout}${stderr}`))
  }
  return stdout
}, Effect.scoped)

import { Effect, Stream } from 'effect'
import { ChildProcess } from 'effect/process'

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
  const maxBuffer = options.maxBuffer ?? 1024 * 1024
  const collect = (stream: typeof handle.stdout) =>
    stream.pipe(
      Stream.runFoldEffect(
        () => {
          const chunks: Uint8Array[] = []
          return { bytes: 0, chunks }
        },
        (output, chunk) => {
          if (output.bytes + chunk.byteLength > maxBuffer) {
            return Effect.die(new Error(`${executable} output exceeded ${maxBuffer} bytes`))
          }
          output.bytes += chunk.byteLength
          output.chunks.push(chunk)
          return Effect.succeed(output)
        },
      ),
      Effect.map((output) => {
        const bytes = new Uint8Array(output.bytes)
        let offset = 0
        for (const chunk of output.chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        return new TextDecoder().decode(bytes)
      }),
    )
  const [stdout, stderr, code] = yield* Effect.all(
    [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
    { concurrency: 'unbounded' },
  )
  if (code !== 0) {
    return yield* Effect.die(new Error(`${executable} exited with ${code}\n${stdout}${stderr}`))
  }
  return stdout
}, Effect.scoped)

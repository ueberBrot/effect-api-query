import { Context, Effect, Layer } from 'effect'

import { makeCommands } from './commands.ts'
import { makeDiagnosticOperations } from './diagnostic-operations.ts'
import { makeUsers } from './users.ts'

const makeDomain = Effect.fn('ExampleDomain.make')(function* () {
  return {
    users: yield* makeUsers(),
    diagnostics: yield* makeDiagnosticOperations(),
    commands: yield* makeCommands(),
  }
})

export class ExampleDomain extends Context.Service<
  ExampleDomain,
  Effect.Success<ReturnType<typeof makeDomain>>
>()('@effect-api-query/server/ExampleDomain') {
  static readonly layer = Layer.effect(ExampleDomain, makeDomain())
}

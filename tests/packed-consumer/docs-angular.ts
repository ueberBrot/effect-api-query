import { Component, signal } from '@angular/core'
import { injectQuery } from '@tanstack/angular-query-experimental'
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

const group = RpcGroup.make(
  Rpc.make('users.read', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
)
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['current-owner'] })

@Component({
  selector: 'user-details',
  standalone: true,
  template: '<button (click)="next()">Next user</button><p>{{ user.data() }}</p>',
})
export class UserDetails {
  readonly id = signal(1)
  readonly user = injectQuery(() =>
    rpc.users.read.queryOptions({
      input: { id: this.id() },
      select: (user) => user.name,
    }),
  )

  next() {
    this.id.update((id) => id + 1)
  }
}

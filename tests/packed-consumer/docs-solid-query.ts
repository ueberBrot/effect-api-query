import { useQuery } from '@tanstack/solid-query'
import { skipToken } from 'effect-api-query'
import { createSignal } from 'solid-js'

import { rpc } from './queries.ts'

const [userId] = createSignal<number | undefined>(1)
const user = useQuery(() => {
  const id = userId()
  return rpc.users.read.queryOptions({
    input: id === undefined ? skipToken : { id },
    select: (value) => value.name,
  })
})

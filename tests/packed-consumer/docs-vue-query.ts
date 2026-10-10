import type { InferDataFromTag, InferErrorFromTag } from '@tanstack/query-core'
import { useQuery } from '@tanstack/vue-query'
import { skipToken } from 'effect-api-query'
import { computed, ref } from 'vue'

import { rpc } from './queries.ts'

const userId = ref<number | undefined>(1)
const options = computed(() =>
  rpc.users.read.queryOptions({
    input: userId.value === undefined ? skipToken : { id: userId.value },
    select: (user) => user.name,
  }),
)
type UserKey = ReturnType<typeof rpc.users.read.queryKey>
const user = useQuery<
  InferDataFromTag<unknown, UserKey>,
  InferErrorFromTag<Error, UserKey>,
  string
>(options)

/* oxlint-disable anti-slop/no-unknown-returns */
export const captureFailure = async (promise: PromiseLike<unknown>): Promise<unknown> => {
  try {
    return await promise
  } catch (error) {
    return error
  }
}
/* oxlint-enable anti-slop/no-unknown-returns */

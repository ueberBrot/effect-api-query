/** Preserves successful results and exposes rejected values for runtime assertions. */
// SAFETY: A rejected JavaScript Promise can contain any value; the tests inspect that value without parsing it away.
/* oxlint-disable anti-slop/no-unknown-returns */
export const captureFailure = async (promise: PromiseLike<unknown>): Promise<unknown> => {
  try {
    return await promise
  } catch (error) {
    return error
  }
}
/* oxlint-enable anti-slop/no-unknown-returns */

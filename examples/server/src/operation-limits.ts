const maxActiveOperations = 32;
const maxActiveOperationsPerOwner = 8;
const maxRetainedOperations = 256;
export const maxPendingCommandReservations = 256;
export const maxPendingCommandReservationsPerOwner = 8;
export const commandReservationTtlMs = 2 * 60 * 60 * 1000;

export const makeOperationAdmission = () => {
  const counts = new Map<string, number>();
  let active = 0;

  return {
    tryAcquire(owner: string) {
      const count = counts.get(owner) ?? 0;
      if (
        active >= maxActiveOperations ||
        count >= maxActiveOperationsPerOwner
      ) {
        return false;
      }
      active += 1;
      counts.set(owner, count + 1);
      return true;
    },
    release(owner: string) {
      const count = counts.get(owner);
      if (count === 1) {
        counts.delete(owner);
      } else if (count !== undefined) {
        counts.set(owner, count - 1);
      }
      active -= 1;
    },
  };
};

export const retainRecentEntry = <A>(
  history: Map<string, A>,
  key: string,
  value: A
) => {
  history.delete(key);
  history.set(key, value);
  if (history.size > maxRetainedOperations) {
    const oldest = history.keys().next();
    if (oldest.done !== true) {
      history.delete(oldest.value);
    }
  }
};

export const operationKey = (owner: string, operationId: string) =>
  JSON.stringify([owner, operationId]);

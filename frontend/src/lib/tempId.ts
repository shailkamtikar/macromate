let counter = 0;

/** A collision-proof id for an optimistic (not-yet-persisted) row --
 * doesn't need to be a UUID, just guaranteed distinct from any real
 * server id, so a caller can later find-and-replace or find-and-remove
 * the optimistic entry once the real request settles. */
export function nextTempId(): string {
  counter += 1;
  return `temp-${Date.now()}-${counter}`;
}

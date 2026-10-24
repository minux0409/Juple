/** A successful withdrawal removes the cached placeholder before the next focus refetch finishes. */
const listeners = new Set<(requestId: number) => void>();
export function notifyJoinRequestWithdrawn(requestId: number): void {
  for (const listener of listeners) listener(requestId);
}
export function subscribeJoinRequestWithdrawn(listener: (requestId: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

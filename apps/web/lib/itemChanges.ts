/**
 * "A link changed" - one tiny in-memory signal (no storage, nothing sent anywhere). With the Quick Detail sheet the list under it stays
 * mounted (that is the point: same page, same scroll), so after a 삭제 / 컬렉션에서 삭제 / 수정 the lists read themselves again instead
 * of waiting for a remount that no longer happens.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyItemsChanged(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeItemsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

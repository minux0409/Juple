type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Tells the Home and Archive lists that the saved links changed somewhere else - today: a link was
 * deleted from, or restored (Undo) after leaving, its Item Details sheet. The lists reload from the
 * server; nothing is patched locally, so what they show is what the server has.
 */
export function notifyItemListChanged(): void {
  [...listeners].forEach(listener => listener());
}

export function onItemListChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

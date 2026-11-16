import { useEffect, useState } from 'react';

/**
 * Which app-wide dialogs are on screen right now, for the few that open by themselves (the app-update prompt, the membership popups,
 * the membership prompt after a refused change). iOS presents one modal at a time, so a dialog that would open while another one is up
 * waits until it has gone, instead of being lost behind it. Memory only; a dialog reports itself open and closed.
 */
const open = new Set<string>();
const listeners = new Set<() => void>();

export function reportDialogOpen(id: string, isOpen: boolean): void {
  const changed = isOpen ? !open.has(id) : open.has(id);
  if (isOpen) {
    open.add(id);
  } else {
    open.delete(id);
  }
  if (changed) {
    listeners.forEach(listener => listener());
  }
}

/** True while any OTHER self-opening dialog is up. */
export function isOtherDialogOpen(id: string): boolean {
  return [...open].some(other => other !== id);
}

/** The same, kept current for a component. */
export function useIsOtherDialogOpen(id: string): boolean {
  const [isOpen, setIsOpen] = useState(() => isOtherDialogOpen(id));
  useEffect(() => {
    const update = () => setIsOpen(isOtherDialogOpen(id));
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, [id]);
  return isOpen;
}

/** For tests. */
export function resetDialogPresence(): void {
  open.clear();
  listeners.forEach(listener => listener());
}

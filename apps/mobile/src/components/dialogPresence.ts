/**
 * Which app-wide dialogs are on screen right now, for the few that open by themselves (the app-update prompt, the membership popups).
 * iOS presents one modal at a time, so a popup that is about to open on its own waits while another one is up instead of being lost
 * behind it. Memory only; a dialog reports itself open and closed.
 */
const open = new Set<string>();

export function reportDialogOpen(id: string, isOpen: boolean): void {
  if (isOpen) {
    open.add(id);
  } else {
    open.delete(id);
  }
}

/** True while any OTHER self-opening dialog is up. */
export function isOtherDialogOpen(id: string): boolean {
  return [...open].some(other => other !== id);
}

/** For tests. */
export function resetDialogPresence(): void {
  open.clear();
}

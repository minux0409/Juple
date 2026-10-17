import { findTourGuide, type TourGuide } from './tourGuides';
import { markTourCompleted } from './tourPreference';

/**
 * The one running tour (if any), outside React so a screen, Help, or the first-run tutorial can start it without a provider.
 * TourHost subscribes. `userKey` is set only for a guide that should remember being finished (the automatic first-run tour).
 */
export interface ActiveTour {
  readonly guide: TourGuide;
  readonly index: number;
  readonly userKey: string | null;
}

let active: ActiveTour | null = null;
const listeners = new Set<() => void>();

function emit(next: ActiveTour | null): void {
  active = next;
  listeners.forEach(listener => listener());
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveTour(): ActiveTour | null {
  return active;
}

/** Starts a guide from its first step. Returns false for an unknown id. A running tour is replaced. */
export function startTour(guideId: string, options: { readonly userKey?: string | null } = {}): boolean {
  const guide = findTourGuide(guideId);
  if (!guide) {
    return false;
  }
  emit({ guide, index: 0, userKey: options.userKey ?? null });
  return true;
}

export function goToTourStep(index: number): void {
  if (!active) {
    return;
  }
  emit({ ...active, index: Math.max(0, Math.min(active.guide.steps.length - 1, index)) });
}

/** Drops the tour without recording anything: the screens it points at went away (sign-out, account switch). */
export function cancelTour(): void {
  emit(null);
}

/** Ends the tour. Finishing AND skipping both count as seen for a guide that remembers (it must not come back every launch). */
export function endTour(): void {
  const current = active;
  if (current?.userKey) {
    markTourCompleted(current.guide.id, current.guide.version, current.userKey).catch(() => undefined);
  }
  emit(null);
}

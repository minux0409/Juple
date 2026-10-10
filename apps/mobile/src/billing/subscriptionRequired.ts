import { ApiError } from '../api/ApiError';

/**
 * The server's two answers to a content write it refuses for lack of a subscription - both a 403 whose ProblemDetails `code` is:
 * - `subscriptionRequired`: the ACTING account's free period ended and it owns no subscription;
 * - `collectionOwnerSubscriptionRequired`: the acting account is fine, but the Collection's OWNER has no live access, so the
 *   Collection cannot be changed for now (reading it is never affected).
 * Reads are never refused. The app turns either into ONE calm prompt (SubscriptionRequiredPrompt); the backend stays the judge.
 *
 * HANDLED: once the prompt has told the person, the refusal is "handled" - it is an ApiError the common helpers below recognise, so a
 * caller's own generic failure message is simply not shown (no timer, no quiet window: it is the error itself that says so).
 * Every other error keeps its normal generic message.
 */
export const SUBSCRIPTION_REQUIRED_CODE = 'subscriptionRequired';
export const OWNER_SUBSCRIPTION_REQUIRED_CODE = 'collectionOwnerSubscriptionRequired';

export type SubscriptionRequiredKind = 'actor' | 'owner';

/** The refusal kind a problem code stands for, or null for every other error. */
export function subscriptionRequiredKindOf(code: string | undefined): SubscriptionRequiredKind | null {
  if (code === SUBSCRIPTION_REQUIRED_CODE) {
    return 'actor';
  }
  return code === OWNER_SUBSCRIPTION_REQUIRED_CODE ? 'owner' : null;
}

/** True for the refusal the prompt already explained to the person - the caller must not add a generic message of its own. */
export function isHandledSubscriptionRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'forbidden' && subscriptionRequiredKindOf(error.code) !== null;
}

/**
 * For a catch block that reports a failure through a callback: runs the report only when the error was NOT already handled by the
 * subscription prompt.
 */
export function unlessRefusalHandled(error: unknown, report: () => void): void {
  if (!isHandledSubscriptionRefusal(error)) {
    report();
  }
}

type Listener = (kind: SubscriptionRequiredKind) => void;
const listeners = new Set<Listener>();

/** Tells whoever shows the prompt that a write was refused for lack of a subscription. Safe with no listener (a headless run). */
export function notifySubscriptionRequired(kind: SubscriptionRequiredKind = 'actor'): void {
  listeners.forEach(listener => listener(kind));
}

export function subscribeSubscriptionRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

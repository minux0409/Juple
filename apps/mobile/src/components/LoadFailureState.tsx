import { ApiError } from '../api/ApiError';
import { ImportantState } from './ImportantState';
import type { ImportantStateVariant } from './ImportantState';

/**
 * Whether a failed load never reached the server (no connection, DNS, timeout - an ApiError 'unavailable' / 'timeout' with
 * no HTTP status) as opposed to a server that answered with an error. Anything that is not a recognised ApiError is
 * treated as "reached it, failed" - never claimed to be offline. Both render the same state (icon and words).
 */
export function loadFailureVariant(error: unknown): Extract<ImportantStateVariant, 'offline' | 'loadFailed'> {
  return error instanceof ApiError && (error.kind === 'timeout' || (error.kind === 'unavailable' && error.status === undefined)) ? 'offline' : 'loadFailed';
}

/**
 * A failure that is a definite answer rather than "could not load": the thing is gone (404), not allowed (403), the
 * session ended (401) or the account is not ready (409). Callers show their specific sentence for these as a notice.
 */
export function isDefinitiveLoadError(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'notFound' || error.kind === 'forbidden' || error.kind === 'unauthorized' || error.kind === 'conflict');
}

/** A failed load as a screen/hook keeps it: the cause (offline vs. failed icon) and, for a definite state, its sentence. */
export interface LoadFailureInfo {
  readonly cause: unknown;
  readonly notice: string | null;
}

interface LoadFailureStateProps {
  /** The caught error (or undefined/null when only "it failed" is known) - offline vs. load-failed (same presentation). */
  readonly error?: unknown;
  /**
   * A definitive state with its own sentence (not found, locked, owner only, signed out) - shown INSTEAD of the load
   * failure. Leave it null for an ordinary failure to load: that always reads the app-wide standard text.
   */
  readonly notice?: string | null;
  readonly onRetry?: () => void;
  readonly compact?: boolean;
  readonly testID?: string;
}

/**
 * A list / page / popup content that failed to load: ImportantState, centered - the broken chain link, "불러오지 못했어요" /
 * "기록을 불러올 수 없습니다." / "다시 시도" whatever the screen or cause. Field validation stays inline and an
 * operation's result is a message dialog - this is only for "the thing this surface shows could not be loaded".
 */
export function LoadFailureState({ error, notice, onRetry, compact, testID }: LoadFailureStateProps) {
  if (notice) {
    return <ImportantState compact={compact} message={notice} onRetry={onRetry} testID={testID} variant="notice" />;
  }
  return <ImportantState compact={compact} onRetry={onRetry} testID={testID} variant={loadFailureVariant(error)} />;
}

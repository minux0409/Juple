import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/ApiError';
import { ImportantState } from './ImportantState';
import type { ImportantStateVariant } from './ImportantState';

/**
 * Whether a failed load never reached the server (no connection, DNS, timeout - an ApiError 'unavailable' / 'timeout' with
 * no HTTP status) as opposed to a server that answered with an error. Anything that is not a recognised ApiError is
 * treated as "reached it, failed" - never claimed to be offline.
 */
export function loadFailureVariant(error: unknown): Extract<ImportantStateVariant, 'offline' | 'loadFailed'> {
  return error instanceof ApiError && (error.kind === 'timeout' || (error.kind === 'unavailable' && error.status === undefined)) ? 'offline' : 'loadFailed';
}

interface LoadFailureStateProps {
  /** The caught error (or undefined/null when only "it failed" is known) - decides offline vs. load failed. */
  readonly error?: unknown;
  /** What could not be loaded, as a full sentence; replaced by the generic connection hint when offline. */
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly compact?: boolean;
  readonly testID?: string;
}

/**
 * A list / page / popup content that failed to load: ImportantState, centered, in its offline ("연결할 수 없어요") or
 * load-failed ("불러오지 못했어요") form. Field validation stays inline and an operation's result is a message dialog -
 * this is only for "the thing this surface shows could not be loaded".
 */
export function LoadFailureState({ error, message, onRetry, retryLabel, compact, testID }: LoadFailureStateProps) {
  const { t } = useTranslation();
  const variant = loadFailureVariant(error);
  return (
    <ImportantState
      compact={compact}
      message={variant === 'offline' ? t('importantState.offlineMessage') : message}
      onRetry={onRetry}
      retryLabel={retryLabel}
      testID={testID}
      variant={variant}
    />
  );
}

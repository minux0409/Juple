import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';

/** Preserve the transport cause instead of turning every failure into an undifferentiated boolean. */
export function browseFailureMessage(error: unknown, t: TFunction): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.kind === 'tooManyRequests') return t('collaboration.tooManyRequests');
  if (error.kind === 'timeout' || error.kind === 'unavailable' && error.status === undefined) return t('history.errorNetwork');
  if (error.status !== undefined && error.status >= 500) return t('history.errorServer');
  if (error.kind === 'unauthorized') return t('errors.unauthorized');
  return null;
}

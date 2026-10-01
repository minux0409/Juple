import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';

/**
 * Why a link could not be proposed (승인 후 추가) - or null when the error is not about that. The
 * server refuses a proposal of a link already in the Collection, or one already waiting for the
 * Owner (also when someone else proposed it first).
 */
export function linkProposalErrorMessage(error: unknown, t: TFunction): string | null {
  if (error instanceof ApiError && error.kind === 'conflict') {
    if (error.code === 'linkAlreadyInCollection') {
      return t('collections.linkAlreadyInCollection');
    }
    if (error.code === 'linkAlreadyPending') {
      return t('collections.linkAlreadyPending');
    }
  }
  return null;
}

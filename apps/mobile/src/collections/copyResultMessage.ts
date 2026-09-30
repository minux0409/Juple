import type { TFunction } from 'i18next';
import type { CopyCollectionItemsResult } from './api/collectionsApi';

/**
 * The one line 내 컬렉션으로 복사 reports: "링크 5개를 복사했어요." when every selected link was
 * copied, otherwise "5개 중 4개를 복사했어요." followed by why the rest were not (already in that
 * Collection / no longer in this one).
 */
export function formatCopyResultMessage(result: CopyCollectionItemsResult, t: TFunction): string {
  const total = result.copiedCount + result.skippedCount + result.unavailableCount;
  if (result.copiedCount === total) {
    return t('collections.copyResultAll', { count: result.copiedCount });
  }
  return [
    t('collections.copyResultPartial', { total, count: result.copiedCount }),
    result.skippedCount > 0 ? t('collections.copyResultSkipped', { count: result.skippedCount }) : null,
    result.unavailableCount > 0 ? t('collections.copyResultUnavailable', { count: result.unavailableCount }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

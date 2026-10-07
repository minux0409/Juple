import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemHistory, getItemHistorySections, type ItemHistoryEntry, type ItemHistorySection } from './api/itemsApi';
import {
  DATE_SECTION_PAGE_SIZE,
  useDateSectionPages,
  type DateSectionPage,
  type DateSectionPagesSource,
  type UseDateSectionPagesResult,
} from './useDateSectionPages';

/** Links per request inside one section - a screenful or two, never the whole section. */
export const HISTORY_SECTION_PAGE_SIZE = DATE_SECTION_PAGE_SIZE;

/** One History section's own loaded links and paging state. Absent (see pages) = never requested. */
export type HistorySectionPage = DateSectionPage<ItemHistoryEntry>;

export type UseHistorySectionsResult = UseDateSectionPagesResult<ItemHistoryEntry> & {
  /** Every non-empty section with its exact total count, newest first. */
  readonly sections: readonly ItemHistorySection[];
};

function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('history.errorLoadFallback');
}

/**
 * History as a summary plus independently paged sections (see useDateSectionPages): GET
 * items/history/sections for the sections and their exact counts, GET items/history with a
 * section's fromUtc/toUtc for its links, HISTORY_SECTION_PAGE_SIZE at a time.
 */
export function useHistorySections(isExpanded: (key: string) => boolean, options: { readonly enabled?: boolean } = {}): UseHistorySectionsResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const source = useMemo<DateSectionPagesSource<ItemHistoryEntry>>(
    () => ({
      loadSections: () => getItemHistorySections(authenticatedRequest),
      loadPage: (section, limit, cursor) =>
        getItemHistory(authenticatedRequest, { limit, cursor, fromUtc: section.fromUtc, toUtc: section.toUtc }),
      idOf: item => item.id,
      errorMessage: error => errorMessage(error, t),
    }),
    [authenticatedRequest, t],
  );
  // enabled false (the Archive in 이름순, which reads the whole archive as one flat list): no summary or page is requested.
  return useDateSectionPages(source, isExpanded, { enabled: options.enabled ?? true }) as UseHistorySectionsResult;
}

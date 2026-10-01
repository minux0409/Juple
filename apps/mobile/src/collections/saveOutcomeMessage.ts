import type { TFunction } from 'i18next';

/** What saving a link did to the Collections it was put into. */
export interface SaveOutcome {
  /** Collections the link joined right away. */
  readonly added: number;
  /** 승인 후 추가 Collections it was only proposed to - it joins once their Owner approves. */
  readonly submitted: number;
}

/**
 * The text of the dialog that must follow a save that proposed the link to 승인 후 추가 Collections
 * (never a toast - this result is easy to misread as a failure if it is missed). It always says the
 * link itself was saved, and - when some Collections took it directly - names both outcomes at once.
 * Only ever called with submitted > 0.
 */
export function formatSaveOutcomeMessage({ added, submitted }: SaveOutcome, t: TFunction): string {
  return added > 0
    ? t('collections.saveOutcomeMixed', { added, submitted })
    : t('collections.saveOutcomeSubmitted', { count: submitted });
}

import type { TFunction } from 'i18next';

/** What saving a link did to the Collections it was put into. */
export interface SaveOutcome {
  /** Collections the link joined right away. */
  readonly added: number;
  /** 승인 후 추가 Collections it was only proposed to - it joins once their Owner approves. */
  readonly submitted: number;
  /** Collections that already had the same link waiting for their Owner - nothing new was proposed there. */
  readonly alreadyPending?: number;
  /** Collections that already had the same link - nothing was added there. */
  readonly alreadyInCollection?: number;
}

/** True when the save did something the person must be told in a dialog rather than a toast. */
export function needsSaveOutcomeDialog({ submitted, alreadyPending = 0, alreadyInCollection = 0 }: SaveOutcome): boolean {
  return submitted > 0 || alreadyPending > 0 || alreadyInCollection > 0;
}

/**
 * The text of the dialog that must follow a save that proposed the link to 승인 후 추가 Collections,
 * or found the link already waiting in (or already in) a chosen Collection (never a toast - this
 * result is easy to misread as a failure if it is missed). It always says the link itself was saved,
 * and - when some Collections took it directly - names both outcomes at once. Only ever called when
 * needsSaveOutcomeDialog is true.
 */
export function formatSaveOutcomeMessage({ added, submitted, alreadyPending = 0, alreadyInCollection = 0 }: SaveOutcome, t: TFunction): string {
  const lines = [
    submitted > 0
      ? added > 0
        ? t('collections.saveOutcomeMixed', { added, submitted })
        : t('collections.saveOutcomeSubmitted', { count: submitted })
      : t('collections.saveOutcomeSaved'),
  ];
  if (alreadyPending > 0) {
    lines.push(t('collections.saveOutcomeAlreadyPending'));
  }
  if (alreadyInCollection > 0) {
    lines.push(t('collections.saveOutcomeAlreadyInCollection'));
  }
  return lines.join('\n');
}

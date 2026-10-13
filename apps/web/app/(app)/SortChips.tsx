'use client';

import type { AppDictionary } from '../../lib/appI18n';
import type { LinkSortOption } from '../../lib/collectionDetails';
import styles from './app.module.css';

/**
 * [시간순] [이름순] - the mobile LinkSortChips: the selected chip carries its direction arrow (↓ newest / ↑ oldest, ↑ A→Z / ↓ Z→A).
 * The arrow's room is kept on the unselected chip too (hidden), so selecting never changes a chip's size or moves its words or its neighbour.
 * Pressing a chip is the caller's choice (the Archive selects; a Collection also flips the direction on a second press).
 */
export function SortChips({
  sort,
  dictionary,
  onPressTime,
  onPressName,
  nameDisabled,
}: {
  readonly sort: LinkSortOption;
  readonly dictionary: AppDictionary;
  readonly onPressTime: () => void;
  readonly onPressName: () => void;
  readonly nameDisabled?: boolean;
}) {
  const timeSelected = sort === 'newest' || sort === 'oldest';
  const timeLabel = sort === 'oldest' ? dictionary.sortTimeOldest : dictionary.sortTimeNewest;
  const nameLabel = sort === 'titleDesc' ? dictionary.sortNameDesc : dictionary.sortNameAsc;
  return (
    <div aria-label={dictionary.sortGroupLabel} className={styles.sortChips} role="group">
      <button aria-label={timeLabel} aria-pressed={timeSelected} className={timeSelected ? styles.filterTabSelected : styles.filterTab} onClick={onPressTime} title={timeLabel} type="button">
        {dictionary.sortTime}
        <span aria-hidden className={timeSelected ? styles.sortArrow : styles.sortArrowHidden}>{sort === 'oldest' ? '↑' : '↓'}</span>
      </button>
      <button
        aria-label={nameLabel}
        aria-pressed={!timeSelected}
        className={!timeSelected ? styles.filterTabSelected : styles.filterTab}
        disabled={nameDisabled}
        onClick={onPressName}
        title={nameLabel}
        type="button"
      >
        {dictionary.sortName}
        <span aria-hidden className={!timeSelected ? styles.sortArrow : styles.sortArrowHidden}>{sort === 'titleDesc' ? '↓' : '↑'}</span>
      </button>
    </div>
  );
}

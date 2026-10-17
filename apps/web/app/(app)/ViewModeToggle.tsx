'use client';

import { tourTarget, type TourTargetId } from '../../lib/tour';
import styles from './app.module.css';

type Mode = 'list' | 'grid' | 'image';

/**
 * The mobile view switch (components/ViewModeToggle.tsx): the same glyphs - three lines (List), four blocks (Grid), nine blocks
 * (Image). Saved links offer all three; the Collections screen only List / Grid, exactly as on mobile.
 */
export function ViewModeToggle<M extends Mode>({
  value,
  onChange,
  labels,
  groupLabel,
  modes = ['list', 'grid', 'image'] as unknown as readonly M[],
  tourId,
}: {
  readonly value: M;
  readonly onChange: (mode: M) => void;
  readonly labels: Readonly<Record<Mode, string>>;
  readonly groupLabel: string;
  readonly modes?: readonly M[];
  /** Marks the toggle for a guided tour (lib/tour.ts TOUR_TARGETS). */
  readonly tourId?: TourTargetId;
}) {
  const glyph = (mode: Mode) =>
    mode === 'list' ? (
      <span aria-hidden className={styles.glyphList}><i /><i /><i /></span>
    ) : mode === 'grid' ? (
      <span aria-hidden className={styles.glyphGrid}><i /><i /><i /><i /></span>
    ) : (
      <span aria-hidden className={styles.glyphImage}>{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>
    );
  return (
    <div aria-label={groupLabel} className={styles.toggle} role="group" {...(tourId ? tourTarget(tourId) : {})}>
      {modes.map(mode => (
        <button
          aria-label={labels[mode]}
          aria-pressed={value === mode}
          className={value === mode ? styles.toggleButtonSelected : styles.toggleButton}
          key={mode}
          onClick={() => onChange(mode)}
          title={labels[mode]}
          type="button"
        >
          {glyph(mode)}
        </button>
      ))}
    </div>
  );
}

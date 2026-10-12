'use client';

import type { HomeViewMode } from '../../lib/homeItems';
import styles from './app.module.css';

/** The mobile List / Grid / Image switch (components/ViewModeToggle.tsx): the same three glyphs - three lines, four blocks, nine blocks. */
export function ViewModeToggle({
  value,
  onChange,
  labels,
  groupLabel,
}: {
  readonly value: HomeViewMode;
  readonly onChange: (mode: HomeViewMode) => void;
  readonly labels: Readonly<Record<HomeViewMode, string>>;
  readonly groupLabel: string;
}) {
  const option = (mode: HomeViewMode, glyph: React.ReactNode) => (
    <button
      aria-label={labels[mode]}
      aria-pressed={value === mode}
      className={value === mode ? styles.toggleButtonSelected : styles.toggleButton}
      onClick={() => onChange(mode)}
      title={labels[mode]}
      type="button"
    >
      {glyph}
    </button>
  );
  return (
    <div aria-label={groupLabel} className={styles.toggle} role="group">
      {option('list', <span aria-hidden className={styles.glyphList}><i /><i /><i /></span>)}
      {option('grid', <span aria-hidden className={styles.glyphGrid}><i /><i /><i /><i /></span>)}
      {option('image', <span aria-hidden className={styles.glyphImage}>{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>)}
    </div>
  );
}

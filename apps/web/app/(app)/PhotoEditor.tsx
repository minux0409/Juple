'use client';
import type { ReactNode } from 'react';
import { Glyph } from './Glyph';
import styles from './app.module.css';

/** Actions stay inside the picture for pointer, keyboard and touch users. */
export function PhotoEditor({ children, hasPhoto, changeLabel, removeLabel, busy, onChange, onRemove }: {
  readonly children: ReactNode; readonly hasPhoto: boolean; readonly changeLabel: string;
  readonly removeLabel: string; readonly busy: boolean; readonly onChange: () => void; readonly onRemove?: () => void;
}) {
  return <div className={styles.photoEditor}>
    {children}
    <div className={hasPhoto ? styles.photoEditorOverlay : styles.photoEditorEmpty}>
      <button disabled={busy} onClick={onChange} type="button"><Glyph name="Image" size={18} />{changeLabel}</button>
      {hasPhoto && onRemove ? <button disabled={busy} onClick={onRemove} type="button"><Glyph name="Trash" size={18} />{removeLabel}</button> : null}
    </div>
  </div>;
}

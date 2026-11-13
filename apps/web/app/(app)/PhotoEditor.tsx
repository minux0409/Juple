'use client';
import type { ReactNode } from 'react';
import { Glyph } from './Glyph';
import styles from './app.module.css';

/** Actions stay inside the picture for pointer, keyboard and touch users. */
export function PhotoEditor({ children, hasPhoto, changeLabel, removeLabel, busy, onChange, onRemove, placeholderGlyph = false }: {
  readonly children: ReactNode; readonly hasPhoto: boolean; readonly changeLabel: string;
  readonly removeLabel: string; readonly busy: boolean; readonly onChange: () => void; readonly onRemove?: () => void;
  /** Without a photo: a camera-like glyph above the button (the placeholder of a link's photo). */
  readonly placeholderGlyph?: boolean;
}) {
  return <div className={hasPhoto ? styles.photoEditor : `${styles.photoEditor} ${styles.photoEditorIsEmpty}`} data-photo-editor={hasPhoto ? 'photo' : 'empty'}>
    {children}
    {!hasPhoto && placeholderGlyph ? <span aria-hidden className={styles.photoEditorGlyph}><Glyph name="Image" size={24} /></span> : null}
    <div className={hasPhoto ? styles.photoEditorOverlay : styles.photoEditorEmpty}>
      <button disabled={busy} onClick={onChange} type="button"><Glyph name="Image" size={18} />{changeLabel}</button>
      {hasPhoto && onRemove ? <button disabled={busy} onClick={onRemove} type="button"><Glyph name="Trash" size={18} />{removeLabel}</button> : null}
    </div>
  </div>;
}

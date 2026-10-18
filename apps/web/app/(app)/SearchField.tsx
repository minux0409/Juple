'use client';

import type { InputHTMLAttributes } from 'react';
import { useSignedInApp } from './AppRoot';
import { Glyph } from './Glyph';
import styles from './app.module.css';

/**
 * The one search field (mobile SearchField): a large rounded white input with a leading magnifier and a clear button once there is
 * text. Hero = the page's own search (보관함), compact = inside a panel. It holds no state: the screen owns the text.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  hero = false,
  inputProps,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly hero?: boolean;
  /** Extra attributes for the input itself (a combobox's role / aria / key handlers): applied after the field's own, which they never replace. */
  readonly inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder' | 'type' | 'className' | 'dir' | 'aria-label'>;
}) {
  const { dictionary } = useSignedInApp();
  return (
    <div className={hero ? `${styles.pickerSearch} ${styles.searchHero}` : styles.pickerSearch}>
      <Glyph className={styles.pickerSearchIcon} name="Search" size={hero ? 20 : 16} />
      <input
        {...inputProps}
        aria-label={placeholder}
        className={styles.textInput}
        dir="auto"
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value ? (
        <button aria-label={dictionary.searchClear} className={styles.pickerClear} onClick={() => onChange('')} title={dictionary.searchClear} type="button">
          ×
        </button>
      ) : null}
    </div>
  );
}

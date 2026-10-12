'use client';

import { useId, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { useSignedInApp } from './AppRoot';
import { CollectionPicker } from './CollectionPicker';
import styles from './app.module.css';

/**
 * The one form family for a link: 새 링크 검토 (/items/new) and 링크 수정 (/items/[id]/edit) are built from these pieces, so the two
 * screens cannot drift apart. They carry layout and presentation only - what is loaded, validated and saved stays in each view.
 *
 *   ItemFormLayout
 *     ItemFormTop            preview (+ its actions) | title, site / URL
 *     ItemFormSections       one card, full width:
 *       ItemCollectionsSection   the shared CollectionPicker (search, ~3 rows, internal scroll)
 *       ItemMemoSection
 *       ItemFormFooter           actions - sticky at the bottom of the card on a tall page
 */

export function ItemFormLayout({ children, onSubmit }: { readonly children: ReactNode; readonly onSubmit: () => void }) {
  return (
    <form
      className={styles.itemForm}
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/** The metadata card: the picture (and what can be done with it) on the left, the link's own fields on the right. */
export function ItemFormTop({ media, children }: { readonly media: ReactNode; readonly children: ReactNode }) {
  return (
    <div className={styles.reviewTop}>
      <div className={styles.photoWorkspace}>{media}</div>
      <div className={styles.itemInfo}>{children}</div>
    </div>
  );
}

export function ItemFormSections({ children }: { readonly children: ReactNode }) {
  return <div className={styles.reviewSections}>{children}</div>;
}

/** 컬렉션 - always the same full-width picker; the caller only decides what is selected. */
export function ItemCollectionsSection(props: ComponentProps<typeof CollectionPicker>) {
  const { dictionary } = useSignedInApp();
  const headingId = useId();
  // title (its own margin-bottom: --form-title-gap = 24px) -> search -> (--space-3 = 12px) -> tiles. No fieldset / legend.
  return (
    <section aria-labelledby={headingId} className={styles.itemCollectionsSection}>
      <h2 className={styles.itemFormSectionTitle} id={headingId}>
        {dictionary.collectionsLabel}
      </h2>
      <CollectionPicker {...props} />
    </section>
  );
}

export function ItemMemoSection({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  const { dictionary } = useSignedInApp();
  return (
    <label className={styles.itemMemoSection}>
      <span className={styles.itemFormSectionTitle}>{dictionary.memo}</span>
      <textarea className={styles.textArea} dir="auto" onChange={event => onChange(event.target.value)} placeholder={dictionary.memoPlaceholder} rows={3} value={value} />
    </label>
  );
}

export function ItemFormFooter({ children }: { readonly children: ReactNode }) {
  return <div className={styles.reviewFooter}>{children}</div>;
}

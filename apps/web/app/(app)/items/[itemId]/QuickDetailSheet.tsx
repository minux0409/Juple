'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { setItemOverlayOpen } from '../../../../lib/itemOverlay';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import { ItemDetailContent } from './ItemDetailContent';
import styles from '../../app.module.css';

/**
 * The Quick Detail sheet: a link's details rising over the page the person is on (Home / 보관함 / a Collection), which stays mounted
 * underneath - same list, same scroll position. A native modal <dialog>: the page behind is inert, focus stays inside, Escape closes it
 * (the URL goes back one entry, so the browser's back button closes it too and forward opens it again). A click on the dimmed
 * backdrop or the close button does the same.
 *
 * Rendered by the intercepting route app/(app)/@modal/(.)items/[itemId] - only for in-app navigation; the address typed, reloaded or
 * opened from outside shows the standalone page with the same ItemDetailContent.
 */
export function QuickDetailSheet({
  itemIdParam,
  lockedBy,
  fromCollectionId,
}: {
  readonly itemIdParam: string;
  readonly lockedBy: number | null;
  readonly fromCollectionId: number | null;
}) {
  const router = useRouter();
  return (
    <QuickSheetFrame>
      <ItemDetailContent fromCollectionId={fromCollectionId} itemIdParam={itemIdParam} lockedBy={lockedBy} onGone={() => router.back()} onLeave={() => router.back()} />
    </QuickSheetFrame>
  );
}

/**
 * The sheet itself, shared by every Quick Detail (my link: QuickDetailSheet; another member's link in a Collection:
 * SharedItemQuickSheet): the dialog, its bar with 닫기, and the scrolling content. Closing goes back one entry in the history.
 */
export function QuickSheetFrame({ children }: { readonly children: React.ReactNode }) {
  const { dictionary } = useSignedInApp();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    // The page underneath is still the person's current page: its visit (a Collection's unlock grant) does not end because the
    // address now names the link.
    setItemOverlayOpen(true);
    return () => setItemOverlayOpen(false);
  }, []);

  const close = () => router.back();

  return (
    <dialog
      aria-label={dictionary.itemDetailsTitle}
      className={styles.quickSheet}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onClick={event => {
        // A click on the backdrop lands on the dialog element itself (its box is the whole screen; the sheet is the inner panel).
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      ref={ref}
    >
      <div className={styles.quickPanel}>
        <header className={styles.quickBar}>
          <span aria-hidden className={styles.quickBarIcon}>
            <Glyph name="Link" size={18} />
          </span>
          <h1 className={styles.quickBarTitle}>{dictionary.itemDetailsTitle}</h1>
          <button aria-label={dictionary.close} className={styles.iconButton} onClick={close} type="button">
            <Glyph name="Close" size={20} />
          </button>
        </header>
        <div className={styles.quickScroll}>{children}</div>
      </div>
    </dialog>
  );
}

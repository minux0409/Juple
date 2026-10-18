'use client';

import { copyText } from '../../lib/copyText';
import { useSignedInApp } from './AppRoot';
import { Glyph } from './Glyph';
import { useToast } from './Toaster';
import styles from './app.module.css';

/**
 * 링크 복사: copies the saved link's ORIGINAL url - exactly what the person saved, never a Juple share link - and says so (or says
 * it could not). Icon-only beside 링크 열기, so it carries the same label as its tooltip and accessible name.
 */
export function CopyLinkButton({ url }: { readonly url: string }) {
  const { dictionary } = useSignedInApp();
  const toast = useToast();
  return (
    <button
      aria-label={dictionary.itemCopyLink}
      className={styles.quickActionButton}
      data-copy-link
      onClick={() => {
        void copyText(url).then(ok => toast.showNotice(ok ? dictionary.itemLinkCopied : dictionary.itemLinkCopyFailed, ok ? 'info' : 'error'));
      }}
      title={dictionary.itemCopyLink}
      type="button"
    >
      <Glyph name="Copy" size={20} />
    </button>
  );
}

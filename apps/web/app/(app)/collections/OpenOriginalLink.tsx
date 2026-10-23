'use client';

import { useSignedInApp } from '../AppRoot';
import { Glyph } from '../Glyph';
import { isSafeHttpUrl } from '../../../lib/savedLinks';
import styles from './ReceivedRequests.module.css';

/**
 * 바로가기 on a request row (mobile: the same icon button on a request's link): opens the saved ORIGINAL page in a new tab. A plain anchor of its
 * own - it never answers, approves, rejects or cancels anything, and the list stays open underneath, so the person comes back to it. Only a
 * safe http(s) address gets a button at all; anything else (a stored value that is not a web address) shows none.
 */
export function OpenOriginalLink({ url, title }: { readonly url: string; readonly title: string }) {
  const { dictionary } = useSignedInApp();
  if (!isSafeHttpUrl(url)) {
    return null;
  }
  return (
    <a aria-label={`${dictionary.openLink}: ${title}`} className={styles.iconButton} data-open-original href={url} rel="noopener noreferrer" target="_blank" title={dictionary.openLink}>
      <Glyph name="ExternalLink" size={18} />
    </a>
  );
}

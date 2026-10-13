'use client';

import { clearCloneResult, copyResultMessage, type CloneOutcome } from '../../../../lib/collectionOperations';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import styles from '../../app.module.css';

/**
 * The new Collection of 내 컬렉션으로 복제 says how the copy went, right after it opens: all copied, or how many and what was not (a
 * failed chunk, links already there or gone meanwhile), and a photo that could not be saved. It stays until it is closed - a partial
 * result is never timed away.
 */
export function CloneResultBanner({ outcome, onDone }: { readonly outcome: Extract<CloneOutcome, { kind: 'done' }>; readonly onDone: () => void }) {
  const { dictionary } = useSignedInApp();
  const partial = outcome.failedChunks > 0;
  const text = [copyResultMessage(outcome.result, dictionary), partial ? dictionary.clonePartialFailure : null, outcome.warning].filter(Boolean).join(' ');
  return (
    <div className={partial ? `${styles.undoBanner} ${styles.undoBannerFailed}` : styles.undoBanner} data-clone-result={partial ? 'partial' : 'complete'} role={partial ? 'alert' : 'status'}>
      <span className={styles.undoBannerText}>{text}</span>
      <button
        aria-label={dictionary.close}
        className={styles.undoBannerClose}
        onClick={() => {
          clearCloneResult(outcome.collectionId);
          onDone();
        }}
        type="button"
      >
        <Glyph name="Close" size={16} />
      </button>
    </div>
  );
}

import type { LinkViewMode } from '../../lib/savedLinks';
import styles from './app.module.css';

/**
 * Placeholders shaped like what is about to appear (the mobile skeleton rows) - never a "loading..." sentence. Decorative: the
 * surrounding region says it is busy. The shimmer stops under prefers-reduced-motion.
 */
export function SavedLinkSkeleton({ mode, count }: { readonly mode: LinkViewMode; readonly count: number }) {
  const slots = Array.from({ length: count }, (_, index) => index);
  if (mode === 'image') {
    return (
      <ul aria-hidden className={styles.imageGrid}>
        {slots.map(index => (
          <li className={styles.imageCell} key={index}>
            <div className={`${styles.imageTile} ${styles.skeleton}`} />
          </li>
        ))}
      </ul>
    );
  }
  if (mode === 'grid') {
    return (
      <ul aria-hidden className={styles.linkGrid}>
        {slots.map(index => (
          <li className={styles.linkCard} key={index}>
            <div className={styles.cardBody}>
              <div className={`${styles.cardImage} ${styles.skeleton}`} />
              <div className={styles.linkText}>
                <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
                <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul aria-hidden className={styles.linkList}>
      {slots.map(index => (
        <li className={styles.linkCard} key={index}>
          <div className={styles.linkRowBody}>
            <div className={`${styles.thumbnail} ${styles.skeleton}`} />
            <div className={styles.linkText}>
              <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
              <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CollectionSkeleton({ mode, count }: { readonly mode: 'grid' | 'list'; readonly count: number }) {
  return (
    <ul aria-hidden className={mode === 'grid' ? styles.collectionGrid : styles.collectionList}>
      {Array.from({ length: count }, (_, index) => (
        <li className={styles.collectionCard} key={index}>
          <div className={styles.collectionBody}>
            <div className={`${styles.collectionTile} ${styles.skeleton}`} />
            <div className={styles.collectionText}>
              <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
              <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SettingsRowSkeleton({ count }: { readonly count: number }) {
  return (
    <div aria-hidden className={styles.settingsCard}>
      {Array.from({ length: count }, (_, index) => (
        <div className={styles.settingsRow} key={index}>
          <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
          <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
        </div>
      ))}
    </div>
  );
}

/** A link's page while it loads: the picture and the facts beside it. */
export function ItemDetailSkeleton() {
  return (
    <div aria-hidden className={styles.itemDetail}>
      <div className={`${styles.itemMedia} ${styles.skeleton}`} />
      <div className={styles.itemInfo}>
        <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
        <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
        <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
      </div>
    </div>
  );
}

/** A Collection's header while it loads: its tile, name and count. */
export function CollectionHeaderSkeleton() {
  return (
    <div aria-hidden className={styles.detailHeader}>
      <div className={`${styles.collectionTile} ${styles.skeleton}`} style={{ width: 56, height: 56 }} />
      <div className={styles.detailHeading} style={{ flex: '1 1 auto' }}>
        <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
        <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
      </div>
    </div>
  );
}

'use client';

import type { AppDictionary } from '../../../lib/appI18n';
import { formatNotificationExactTime, formatNotificationTime, notificationLeadingOf, PREVIEW_TYPES, type AppNotification } from '../../../lib/notifications';
import { isSafeHttpUrl } from '../../../lib/savedLinks';
import { Avatar } from '../Avatar';
import { Glyph } from '../Glyph';
import { LinkImage } from '../LinkImage';
import styles from '../app.module.css';

const LEADING_SIZE = 40;

/** Who / what a row is about (mobile NotificationLeading): the Collection for an approval request, the person who caused it, else the type glyph. */
function Leading({ notification }: { readonly notification: AppNotification }) {
  const leading = notificationLeadingOf(notification);
  if (leading.kind === 'actor') {
    return <Avatar person={leading.actor} size={LEADING_SIZE} />;
  }
  if (leading.kind === 'collection' && leading.imageUrl && isSafeHttpUrl(leading.imageUrl)) {
    return (
      <span aria-hidden className={styles.notificationGlyph}>
        <LinkImage className={styles.notificationLeadingImage} fallback={<Glyph name="Folder" size={20} />} src={leading.imageUrl} />
      </span>
    );
  }
  return (
    <span aria-hidden className={styles.notificationGlyph}>
      <Glyph name={leading.kind === 'collection' ? 'Folder' : leading.glyph} size={20} />
    </span>
  );
}

/**
 * One notification (mobile NotificationRow): who / what it is about, the sentence the Push used (or the mobile "no longer available"
 * line when its target is gone), when it arrived and in which Collection, the thumbnail of my own link where the type is about one
 * (the full list only), and - while unread - a soft tint, a stronger line and a dot. The whole row is one button.
 */
export function NotificationRow({
  notification,
  dictionary,
  locale,
  compact = false,
  onOpen,
}: {
  readonly notification: AppNotification;
  readonly dictionary: AppDictionary;
  readonly locale: string;
  /** The bell's panel: no thumbnail. */
  readonly compact?: boolean;
  readonly onOpen: () => void;
}) {
  const isUnread = notification.readAtUtc === null;
  const text = notification.body ?? dictionary.notificationsUnavailable;
  const time = formatNotificationTime(notification.createdAtUtc, dictionary, locale);
  const exact = formatNotificationExactTime(notification.createdAtUtc, locale);
  const label = [isUnread ? dictionary.notificationsUnreadA11y : null, text, notification.collectionName, exact].filter(Boolean).join(', ');
  const previewUrl = !compact && PREVIEW_TYPES.has(notification.type) && isSafeHttpUrl(notification.previewImageUrl) ? (notification.previewImageUrl ?? null) : null;

  return (
    <button aria-label={label} className={isUnread ? styles.notificationRowUnread : styles.notificationRow} onClick={onOpen} type="button">
      <Leading notification={notification} />
      <span className={styles.notificationText}>
        <span className={isUnread ? styles.notificationBodyUnread : styles.notificationBody} dir="auto">
          {text}
        </span>
        <span className={styles.notificationMeta} title={exact}>
          {time}
          {notification.collectionName ? (
            <>
              {' · '}
              <span dir="auto">{notification.collectionName}</span>
            </>
          ) : null}
        </span>
      </span>
      {previewUrl ? <LinkImage className={styles.notificationPreview} fallback={null} src={previewUrl} /> : null}
      {isUnread ? <span aria-hidden className={styles.unreadDot} /> : null}
    </button>
  );
}

/** Rows while the first page loads. */
export function NotificationSkeleton({ count }: { readonly count: number }) {
  return (
    <div aria-hidden className={styles.notificationSkeletons}>
      {Array.from({ length: count }, (_, index) => (
        <div className={styles.notificationRow} key={index}>
          <span className={`${styles.notificationGlyph} ${styles.skeleton}`} />
          <span className={styles.notificationText}>
            <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
            <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

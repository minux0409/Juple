import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatCommentTime } from '../comments/formatCommentTime';
import { UserAvatar } from '../components/UserAvatar';
import { FolderIcon } from '../icons/FolderIcon';
import { GlobeIcon } from '../icons/GlobeIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { UserIcon } from '../icons/UserIcon';
import { getHostnameFromUrl } from '../items/savedLinkPrimaryText';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';
import { personLabel } from './api/collaborationApi';
import type { CollectionItemAdder } from './api/collectionsApi';

/** Compact card geometry (project tokens): a 64dp thumbnail, 10dp card padding, 2dp between lines. */
export const PENDING_SUBMISSION_THUMBNAIL_SIZE = 64;
const CARD_PADDING = spacing.sm + 2;
const LINE_GAP = 2;
const CONTEXT_ICON_SIZE = 13;

/** What the card shows of one waiting link - the same shape for the Owner's queue and a submitter's own list. */
export interface PendingSubmissionRow {
  readonly submissionId: number;
  readonly url: string;
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  readonly submittedAtUtc: string;
  /** Owner variant: who proposed it - null for someone who proposed through the public link (never named). */
  readonly proposer?: CollectionItemAdder | null;
  /**
   * Mine variant, across Collections: the Collection it waits in; null = one of mine in a Collection I am not a
   * member of (a public-link request, the link maybe revoked) - said generically, never by name. Undefined: a
   * list scoped to one Collection, which needs no Collection said.
   */
  readonly collectionName?: string | null;
}

interface PendingSubmissionCardProps {
  readonly row: PendingSubmissionRow;
  /** 'owner' = the Owner's queue (proposer line, action strip below); 'mine' = my own proposal (context line). */
  readonly variant: 'owner' | 'mine';
  /**
   * The card's icon actions in a fixed area at its end, beside the information - never a row of their own,
   * never overlapping the title: the requester's external-link icon, or the Owner's reject (X) and approve (check).
   */
  readonly trailing?: ReactNode;
  /**
   * Owner variant: the action strip under the information - three equal icon zones (open link, reject,
   * approve), separated from the content by a hairline. The information itself is not interactive.
   */
  readonly actionStrip?: ReactNode;
  /**
   * Inside a SwipeableItemRow: the swipe FRAME owns the card's outer shape - its rounded corners, hairline border and
   * clip - and this card only fills it (no border or radius of its own). So closed, all four corners are intact (a
   * square inner border is never cut off by the rounded clip); swiped, the red action is one continuous underlay of the
   * same rounded row - no gap, no separate red box.
   */
  readonly embedded?: boolean;
}

/**
 * One link waiting for approval - the single compact card for both popups (ApprovalSubmissionSheet):
 *
 *   [thumbnail]  Title (2 lines)                [trailing icons]
 *                host
 *                [icon] Collection · 3분 전
 *
 * The Owner's card adds a strip below: [open link] [reject X] [approve check], three equal zones.
 *
 * There is no "waiting for approval" line: the sheet's own title already says every card is pending. The
 * context is the Collection's name for a Collection I belong to, a generic "공유 컬렉션" otherwise (never a
 * private name), and nothing in a list scoped to one Collection. The Owner's card shows who proposed it
 * (a public-link proposer only as that, never by name) instead, with the action strip below.
 */
export function PendingSubmissionCard({ row, variant, trailing, actionStrip, embedded = false }: PendingSubmissionCardProps) {
  const { t } = useTranslation();
  const hostname = getHostnameFromUrl(row.url) ?? row.url;
  const title = row.title?.trim() ? row.title : hostname;
  const time = formatCommentTime(row.submittedAtUtc, t);
  const contextName = row.collectionName ? row.collectionName : row.collectionName === null ? t('submissions.sharedCollectionShort') : null;
  const ContextIcon = row.collectionName ? FolderIcon : ShareIcon;

  return (
    <View style={[styles.card, embedded && styles.cardEmbedded]} testID={variant === 'owner' ? `submission-${row.submissionId}` : `my-submission-${row.submissionId}`}>
      <View style={styles.top}>
        <View
          accessibilityLabel={variant === 'mine' ? [title, contextName, time].filter(Boolean).join(', ') : undefined}
          accessible={variant === 'mine'}
          style={styles.info}
          testID={variant === 'mine' ? `my-submission-info-${row.submissionId}` : undefined}
        >
        {row.previewImageUrl ? (
          <Image source={{ uri: row.previewImageUrl }} style={styles.thumbnail} testID={`submission-thumbnail-${row.submissionId}`} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            <GlobeIcon color={colors.textSecondary} size={22} />
          </View>
        )}
        <View style={styles.text}>
          <Text numberOfLines={2} style={styles.title} testID={`submission-title-${row.submissionId}`}>{title}</Text>
          <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{hostname}</Text>
          {variant === 'owner' ? (
            <View style={styles.contextRow}>
              {row.proposer?.jupleId ? (
                <>
                  <UserAvatar
                    displayName={row.proposer.displayName}
                    imageUrl={row.proposer.profileImageUrl}
                    imageVersion={row.proposer.profileImageVersion}
                    jupleId={row.proposer.jupleId}
                    size={16}
                  />
                  <Text numberOfLines={1} style={styles.contextName} testID={`submission-proposer-${row.submissionId}`}>
                    {personLabel({ jupleId: row.proposer.jupleId, displayName: row.proposer.displayName })}
                  </Text>
                </>
              ) : (
                <>
                  <UserIcon color={colors.textSecondary} size={CONTEXT_ICON_SIZE} strokeWidth={2} />
                  <Text numberOfLines={1} style={styles.contextName} testID={`submission-proposer-${row.submissionId}`}>
                    {t('submissions.viaPublicLink')}
                  </Text>
                </>
              )}
              <Text numberOfLines={1} style={styles.time}>· {time}</Text>
            </View>
          ) : (
            <View style={styles.contextRow} testID={`my-submission-context-${row.submissionId}`}>
              {contextName ? (
                <>
                  <ContextIcon color={colors.textSecondary} size={CONTEXT_ICON_SIZE} />
                  <Text numberOfLines={1} style={styles.contextName}>{contextName}</Text>
                  <Text numberOfLines={1} style={styles.time}>· {time}</Text>
                </>
              ) : (
                <Text numberOfLines={1} style={styles.time}>{time}</Text>
              )}
            </View>
          )}
        </View>
        </View>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {actionStrip ? <View style={styles.actionStrip}>{actionStrip}</View> : null}
    </View>
  );
}

/**
 * Where a card is about to appear, inside the sheet's final geometry (same frame, thumbnail and line
 * heights), so the sheet opens at its real size and the cards land in place instead of the sheet
 * resizing. Static, hidden from accessibility.
 */
export function PendingSubmissionCardSkeleton({ testID }: { readonly testID?: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.card} testID={testID}>
      <View style={styles.top}>
        <View style={styles.info}>
          <View style={styles.thumbnail} />
          <View style={styles.text}>
            <View style={[styles.skeletonLine, styles.skeletonTitle]} />
            <View style={[styles.skeletonLine, styles.skeletonSite]} />
            <View style={[styles.skeletonLine, styles.skeletonStatus]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonLine: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, height: 14, marginTop: LINE_GAP },
  skeletonTitle: { width: '80%' },
  skeletonSite: { width: '45%' },
  skeletonStatus: { width: '60%' },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: CARD_PADDING,
  },
  cardEmbedded: { borderRadius: 0, borderWidth: 0 },
  top: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  info: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm + 2, minWidth: 0 },
  thumbnail: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    height: PENDING_SUBMISSION_THUMBNAIL_SIZE,
    width: PENDING_SUBMISSION_THUMBNAIL_SIZE,
  },
  // The Owner's strip: a hairline above, then the three icon zones (each one third of the card width).
  actionStrip: { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: -CARD_PADDING, marginBottom: -CARD_PADDING },
  thumbnailPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: LINE_GAP, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 12 },
  contextRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minWidth: 0 },
  contextName: { color: colors.textSecondary, flexShrink: 1, fontSize: 12, fontWeight: '600' },
  time: { color: colors.textSecondary, flexShrink: 0, fontSize: 12 },
  // A fixed area at the end: the title flexes and ellipsizes, the icons never wrap onto a row of their own.
  trailing: { alignItems: 'center', flexDirection: 'row', flexShrink: 0 },
});

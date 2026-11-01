import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { LinkIcon } from '../icons/LinkIcon';
import { usablePreviewImageUrl } from '../items/usablePreviewImageUrl';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';
import type { ModerationNotice } from './moderationNoticeApi';
import { moderationActionLabel, moderationActionSentence, moderationReasonLabel } from './moderationNoticeText';

/** The one sentence a notice opens with: what was done (an action), that a warning was sent, or that the person's report was reviewed. */
export function moderationNoticeIntro(notice: ModerationNotice, t: TFunction): string {
  if (notice.kind === 'reportResult') {
    return t('moderation.resultMessage');
  }
  return moderationActionSentence(notice, t) ?? t('moderation.warningIntro');
}

export function moderationNoticeTitle(notice: ModerationNotice, t: TFunction): string {
  return t(notice.kind === 'reportResult' ? 'moderation.resultTitle' : 'moderation.teamTitle');
}

/**
 * What an operator message adds to its first sentence: the content it was about, the reason, the team's guidance and when it happened. The same
 * wherever it is read - the notice screen (from the Inbox or a push tap) and the pop-up that tells the person on launch. The words are the operator's,
 * plain text; the title is the snapshot taken when it was made, so it reads the same after the link or Collection is deleted. Nothing of the report
 * (who, what they wrote) is in it.
 */
export function ModerationNoticeDetails({ notice, compact = false }: { readonly notice: ModerationNotice; readonly compact?: boolean }) {
  const { t, i18n } = useTranslation();
  if (notice.kind === 'reportResult') {
    return null;
  }
  const actionLabel = moderationActionLabel(notice, t);
  const reasonCode = moderationReasonLabel(notice, t);
  const actedAt = new Date(notice.createdAtUtc);
  const hasDate = !Number.isNaN(actedAt.getTime());
  return (
    <View style={compact ? styles.compact : styles.details} testID="moderation-notice-details">
      <ModerationNoticeContent compact={compact} notice={notice} />
      {actionLabel ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('moderation.actionLabel')}</Text>
          <Text style={styles.body} testID="moderation-notice-action">{actionLabel}</Text>
        </View>
      ) : null}
      {reasonCode ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('moderation.reasonCodeLabel')}</Text>
          <Text style={styles.body} testID="moderation-notice-reason-code">{reasonCode}</Text>
        </View>
      ) : null}
      {notice.reason ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('moderation.reasonLabel')}</Text>
          <Text style={styles.body} testID="moderation-notice-reason">{notice.reason}</Text>
        </View>
      ) : null}
      {notice.guidance ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('moderation.guidanceLabel')}</Text>
          <Text style={styles.body} testID="moderation-notice-guidance">{notice.guidance}</Text>
        </View>
      ) : null}
      {hasDate ? (
        <Text style={styles.date} testID="moderation-notice-date">
          {t('moderation.actedAtLabel')} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(actedAt)}
        </Text>
      ) : null}
    </View>
  );
}

/** Which link or Collection it was about: the picture, title and Collection kept when the notice was made. Nothing is shown that was not kept. */
function ModerationNoticeContent({ notice, compact }: { readonly notice: ModerationNotice; readonly compact: boolean }) {
  const { t } = useTranslation();
  const title = notice.contentTitle?.trim() || null;
  if (notice.contentType === null || (title === null && notice.collectionName === null && notice.contentType !== 'Item')) {
    return null;
  }
  return (
    <View style={styles.content} testID="moderation-notice-target">
      {notice.contentType === 'Item' ? (
        <ItemRepresentativeThumbnail fallback={<LinkIcon color={colors.textSecondary} size={22} />} imageUrl={usablePreviewImageUrl(notice.contentImageUrl)} />
      ) : null}
      <View style={styles.contentText}>
        {title ? <Text numberOfLines={compact ? 3 : undefined} style={styles.contentTitle} testID="moderation-notice-content">{title}</Text> : null}
        {notice.collectionName ? (
          <Text numberOfLines={compact ? 2 : undefined} style={styles.contentMeta} testID="moderation-notice-collection">{t('moderation.sharedCollectionLine', { name: notice.collectionName })}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** The whole message as a card (the notice screen). */
export function ModerationNoticeBody({ notice }: { readonly notice: ModerationNotice }) {
  const { t } = useTranslation();
  return (
    <View style={styles.card} testID="moderation-notice-body">
      <Text accessibilityRole="header" style={styles.title}>{moderationNoticeTitle(notice, t)}</Text>
      <Text style={styles.body}>{moderationNoticeIntro(notice, t)}</Text>
      <ModerationNoticeDetails notice={notice} />
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  details: { gap: spacing.md },
  compact: { gap: spacing.sm, marginTop: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  content: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: 'row', gap: spacing.md, minWidth: 0, padding: spacing.sm },
  contentText: { flex: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  contentTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  contentMeta: { color: colors.textSecondary, fontSize: 13 },
  section: { gap: spacing.xs },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  date: { color: colors.textSecondary, fontSize: 12 },
}));

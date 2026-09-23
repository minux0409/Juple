import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SiteIcon } from '../icons/SiteIcon';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveEffectiveThumbnailUrl } from '../items/resolveEffectiveThumbnailUrl';
import { resolveSavedLinkPrimaryText } from '../items/savedLinkPrimaryText';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';

interface SavedLinkGridCardProps { readonly item: ItemHistoryEntry; readonly isActionInFlight: boolean; readonly preferEffectiveThumbnail?: boolean; }

/** Presentation-only compact counterpart to SavedLinkRow; parent SwipeableItemRow keeps all actions intact. */
export function SavedLinkGridCard({ item, isActionInFlight, preferEffectiveThumbnail }: SavedLinkGridCardProps) {
  const imageUrl = preferEffectiveThumbnail ? resolveEffectiveThumbnailUrl(item) : item.representativeImage?.readUrl ?? null;
  const site = resolveSiteInfo(item.url);
  return <View style={styles.card}>
    <View style={styles.image}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.thumbnail} /> : <View style={styles.fallback}><SiteIcon siteId={site.id} size={42} /></View>}
      {isActionInFlight ? <View style={styles.overlay}><ActivityIndicator color={colors.surface} size="small" /></View> : null}
    </View>
    <Text numberOfLines={2} style={[styles.title, !item.title && ltrTextStyle]}>{resolveSavedLinkPrimaryText(item.title, item.url)}</Text>
    <Text numberOfLines={1} style={styles.memo}>{item.memo ?? site.label ?? ''}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  image: { aspectRatio: 1, borderRadius: radii.md + 4, overflow: 'hidden', position: 'relative' },
  thumbnail: { height: '100%', width: '100%' },
  fallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, flex: 1, justifyContent: 'center' },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', lineHeight: 18, marginTop: spacing.xs },
  memo: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
});

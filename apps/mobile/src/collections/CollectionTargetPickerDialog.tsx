import { useEffect, useRef } from 'react';
import { Animated, Easing, FlatList, Modal, Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIconTile } from './CategoryIconTile';
import type { Collection } from './api/collectionsApi';
import { colors, radii, spacing } from '../theme/tokens';

// Comfortably past this component's own maxHeight ('75%') on any real device, so the sheet always
// starts fully off-screen below regardless of exact screen height - see the entrance animation
// below for why a precise Dimensions-based value isn't needed.
const SHEET_ENTER_OFFSET = 800;
const SHEET_ENTER_DURATION_MS = 250;

/**
 * Shared by Add/Move/Merge target selection (CollectionDetailsScreen's targetMode) - a bottom
 * sheet whose Cancel row must stay fully above the Android system navigation area (gesture bar or
 * 3-button nav), never underneath it. useSafeAreaInsets() is read directly here (not a prop
 * threaded through from the one current caller) so every caller of this shared component - now
 * and any added later - gets the fix automatically.
 *
 * animationType="none" - RN's own "slide" animates the *entire* Modal window (transparent
 * backdrop included), which visibly drags the dim backdrop up from the bottom together with the
 * sheet, drawing the eye to motion that shouldn't be there. The backdrop below renders at its
 * final dim color the instant the Modal itself appears (no animation of its own); only the white
 * sheet content animates in, via a plain Animated.Value translateY (no new dependency). Closing is
 * a plain instant cut (matching animationType="none") rather than a mirrored slide-down - the
 * explicit ask here was fixing the backdrop’s *opening* motion, and a hand-rolled reverse-animate-
 * then-close would need to delay onCancel/onRequestClose itself, real complexity for a currently
 * unreported problem.
 */
export function CollectionTargetPickerDialog({ visible, collections, isLoading, isLoadingMore, onSelect, onCancel, onLoadMore }: {
  readonly visible: boolean; readonly collections: readonly Collection[]; readonly isLoading: boolean;
  readonly onSelect: (collection: Collection) => void; readonly onCancel: () => void; readonly onLoadMore: () => void; readonly isLoadingMore: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const sheetTranslateY = useRef(new Animated.Value(SHEET_ENTER_OFFSET)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }
    sheetTranslateY.setValue(SHEET_ENTER_OFFSET);
    Animated.timing(sheetTranslateY, {
      toValue: 0,
      duration: SHEET_ENTER_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, sheetTranslateY]);

  return <Modal animationType="none" onRequestClose={onCancel} transparent visible={visible}>
    <View style={styles.overlay}><Animated.View style={[styles.card, { paddingBottom: spacing.xl + insets.bottom, transform: [{ translateY: sheetTranslateY }] }]}><Text style={styles.title}>{t('collections.targetPickerTitle')}</Text>
      {isLoading ? <ActivityIndicator /> : <FlatList data={collections} keyExtractor={item => String(item.id)} onEndReached={onLoadMore} onEndReachedThreshold={0.5} renderItem={({ item }) =>
        <Pressable accessibilityLabel={item.name} accessibilityRole="button" onPress={() => onSelect(item)} style={styles.row}>
          <CategoryIconTile collectionId={item.id} color={item.color} icon={item.icon} size={32} /><Text style={styles.name}>{item.name}</Text>
        </Pressable>} ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : undefined} />}
      <Pressable accessibilityLabel={t('common.cancel')} accessibilityRole="button" onPress={onCancel} style={styles.cancel}><Text>{t('common.cancel')}</Text></Pressable>
    </Animated.View></View>
  </Modal>;
}
const styles = StyleSheet.create({ overlay: { backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'flex-end' }, card: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '75%', padding: spacing.xl }, title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.md }, row: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md }, name: { color: colors.textPrimary, flex: 1, fontSize: 16 }, cancel: { alignItems: 'center', paddingTop: spacing.lg } });

import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CategoryIconTile } from './CategoryIconTile';
import type { Collection } from './api/collectionsApi';
import { colors, radii, spacing } from '../theme/tokens';

export function CollectionTargetPickerDialog({ visible, collections, isLoading, isLoadingMore, onSelect, onCancel, onLoadMore }: {
  readonly visible: boolean; readonly collections: readonly Collection[]; readonly isLoading: boolean;
  readonly onSelect: (collection: Collection) => void; readonly onCancel: () => void; readonly onLoadMore: () => void; readonly isLoadingMore: boolean;
}) {
  const { t } = useTranslation();
  return <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
    <View style={styles.overlay}><View style={styles.card}><Text style={styles.title}>{t('collections.targetPickerTitle')}</Text>
      {isLoading ? <ActivityIndicator /> : <FlatList data={collections} keyExtractor={item => String(item.id)} onEndReached={onLoadMore} onEndReachedThreshold={0.5} renderItem={({ item }) =>
        <Pressable accessibilityLabel={item.name} accessibilityRole="button" onPress={() => onSelect(item)} style={styles.row}>
          <CategoryIconTile collectionId={item.id} color={item.color} icon={item.icon} size={32} /><Text style={styles.name}>{item.name}</Text>
        </Pressable>} ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : undefined} />}
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}><Text>{t('common.cancel')}</Text></Pressable>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({ overlay: { backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'flex-end' }, card: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '75%', padding: spacing.xl }, title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.md }, row: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md }, name: { color: colors.textPrimary, flex: 1, fontSize: 16 }, cancel: { alignItems: 'center', paddingTop: spacing.lg } });

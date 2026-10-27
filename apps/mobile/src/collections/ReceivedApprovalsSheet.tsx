import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { Pressable } from '../components/Pressable';
import { AppModal } from '../components/AppModal';
import { CountBadge } from '../components/CountBadge';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import type { Collection } from './api/collectionsApi';
import { CategoryIconTile } from './CategoryIconTile';

/** One Collection whose Owner (the signed-in user) has proposed links or join requests to answer. */
export function approvalCollections(collections: readonly Collection[] | null | undefined): readonly Collection[] {
  return (collections ?? []).filter(
    collection => (collection.accessRole ?? 'owner').toLowerCase() === 'owner'
      && (collection.pendingSubmissionCount ?? 0) + (collection.pendingJoinRequestCount ?? 0) > 0,
  );
}

interface ReceivedApprovalsSheetProps {
  readonly visible: boolean;
  readonly collections: readonly Collection[];
  readonly onClose: () => void;
  /** Opens the Collection on the list that actually answers the request (links first, then join requests). */
  readonly onOpen: (collection: Collection) => void;
}

/**
 * 받은 승인 요청 (Collections > 공유 컬렉션): which of MY Collections have requests waiting. The answering UI is the
 * Collection's own (links and join requests, with their role/lock checks) - this sheet only routes there, so the
 * rules cannot differ between the two entrances.
 */
export function ReceivedApprovalsSheet({ visible, collections, onClose, onOpen }: ReceivedApprovalsSheetProps) {
  const { t } = useTranslation();
  return (
    <AppModal onClose={onClose} testID="received-approvals-sheet" title={t('collections.pendingSubmissions')} visible={visible}>
      <ScrollView style={styles.list}>
        {collections.map(collection => {
          const count = (collection.pendingSubmissionCount ?? 0) + (collection.pendingJoinRequestCount ?? 0);
          return (
            <Pressable
              accessibilityLabel={`${collection.name}, ${t('collections.pendingSubmissionsA11y', { count })}`}
              accessibilityRole="button"
              key={collection.id}
              onPress={() => onOpen(collection)}
              style={styles.row}
              testID={`received-approvals-${collection.id}`}
            >
              <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} size={44} />
              <Text numberOfLines={2} style={styles.name}>{collection.name}</Text>
              <CountBadge count={count} />
            </Pressable>
          );
        })}
      </ScrollView>
    </AppModal>
  );
}

const styles = themedStyles(() => ({
  list: { flexGrow: 0, maxHeight: 420 },
  row: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    padding: spacing.md,
  },
  name: { color: colors.textPrimary, flex: 1, fontSize: 16, fontWeight: '700', minWidth: 0 },
}));

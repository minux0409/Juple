import { useRef } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { PendingActionRow } from '../components/PendingActionRow';
import { Pressable } from '../components/Pressable';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

interface Props {
  readonly visible: boolean;
  readonly approvalCount: number;
  readonly joinCount: number;
  readonly onClose: () => void;
  readonly onOpenApprovals: () => void;
  readonly onOpenJoinRequests: () => void;
}

export function CollectionReviewRequestsSheet({ visible, approvalCount, joinCount, onClose, onOpenApprovals, onOpenJoinRequests }: Props) {
  const { t } = useTranslation();
  const nextSheet = useRef<(() => void) | null>(null);
  const openNextSheet = () => {
    const open = nextSheet.current;
    nextSheet.current = null;
    open?.();
  };
  const select = (open: () => void) => {
    if (nextSheet.current) return;
    nextSheet.current = open;
    onClose();
    // iOS can present the next native modal only after the first has been dismissed.
    if (Platform.OS !== 'ios') openNextSheet();
  };
  const renderRequest = (label: string, count: number, open: () => void, testID: string) => count > 0 ? (
    <PendingActionRow
      accessibilityLabel={label + ', ' + t('collections.myPendingStatus', { count })}
      compact
      count={count}
      label={label}
      onPress={() => select(open)}
      testID={testID}
    />
  ) : null;

  return (
    <BottomSheetModal
      headerActions={
        <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" onPress={onClose} style={styles.close}>
          <CloseIcon color={colors.textSecondary} size={20} />
        </Pressable>
      }
      headerTitle={<Text accessibilityRole="header" style={styles.title}>{t('collections.reviewRequests')}</Text>}
      onClose={onClose}
      onDismiss={openNextSheet}
      testID="collection-review-requests-sheet"
      visible={visible}
    >
      <ScrollView contentContainerStyle={styles.rows}>
        {renderRequest(t('collections.pendingSubmissions'), approvalCount, onOpenApprovals, 'collection-review-approvals')}
        {renderRequest(t('collections.joinRequests'), joinCount, onOpenJoinRequests, 'collection-review-join')}
        {approvalCount + joinCount === 0 ? <Text style={styles.empty}>{t('submissions.empty')}</Text> : null}
      </ScrollView>
    </BottomSheetModal>
  );
}

const styles = themedStyles(() => ({
  close: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 18, fontWeight: '700' },
  rows: { gap: spacing.sm },
  empty: { color: colors.textSecondary },
}));

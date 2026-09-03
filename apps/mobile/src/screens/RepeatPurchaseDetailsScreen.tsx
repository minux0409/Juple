import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { getRepeatPurchase, type RepeatPurchase } from '../purchases/api/repeatPurchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';
import { formatIntervalDescription } from '../purchases/repeatPurchaseFormat';

type Props = NativeStackScreenProps<RootStackParamList, 'RepeatPurchaseDetails'>;

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return '이미 삭제되었거나 찾을 수 없는 반복 구매입니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '반복 구매를 불러올 수 없습니다.';
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function RepeatPurchaseDetailsScreen({ route, navigation }: Props) {
  const { repeatPurchaseId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();

  const [repeatPurchase, setRepeatPurchase] = useState<RepeatPurchase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Discards a stale in-flight load's result if a newer one has since started.
  const requestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const fetched = await getRepeatPurchase(authenticatedRequest, repeatPurchaseId);
      if (requestIdRef.current !== requestId) {
        return;
      }
      setRepeatPurchase(fetched);
    } catch (caughtError) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      // Failure keeps whatever RepeatPurchase data is already on screen - only the error text changes.
      setError(getLoadErrorMessage(caughtError));
    } finally {
      if (requestIdRef.current === requestId) {
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
      }
    }
  }, [authenticatedRequest, repeatPurchaseId]);

  // Refetches every time this screen regains focus, so a save from RepeatPurchaseEditor (which
  // pops back here) is reflected without a manual refresh step.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (isLoading && !repeatPurchase) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!repeatPurchase) {
    return (
      <View style={styles.loadingContainer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.productName}>{repeatPurchase.productName}</Text>

      <DetailRow
        label="주기"
        value={formatIntervalDescription(repeatPurchase.intervalValue, repeatPurchase.intervalUnit)}
      />
      <DetailRow
        label="다음 예상 구매일"
        value={formatDateOnlyForDisplay(repeatPurchase.nextPurchaseDate)}
      />
      {/* Enable/disable is not an action in this round - purely informational status text. */}
      <DetailRow label="상태" value={repeatPurchase.isEnabled ? '활성' : '일시중지'} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          navigation.navigate('RepeatPurchaseEditor', {
            repeatPurchaseId: repeatPurchase.id,
            initialRepeatPurchase: repeatPurchase,
          })
        }
        style={styles.editButton}
      >
        <Text style={styles.editButtonLabel}>수정</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  productName: {
    color: '#111111',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  row: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  rowLabel: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  rowValue: {
    color: '#111111',
    fontSize: 15,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 16,
  },
  editButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 24,
    paddingVertical: 12,
  },
  editButtonLabel: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
  },
});

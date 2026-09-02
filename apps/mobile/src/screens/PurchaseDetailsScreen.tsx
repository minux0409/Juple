import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { deletePurchase, getPurchase, type Purchase } from '../purchases/api/purchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseDetails'>;

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return '이미 삭제되었거나 찾을 수 없는 구매 기록입니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '구매 기록을 불러올 수 없습니다.';
}

function getDeleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '구매 기록을 삭제할 수 없습니다.';
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function PurchaseDetailsScreen({ route, navigation }: Props) {
  const { purchaseId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Discards a stale in-flight load's result if a newer one has since started.
  const requestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Synchronous re-entrancy guard for delete, and also skips a focus-triggered reload while a
  // delete is in flight (the screen is about to be popped either way).
  const isDeletingRef = useRef(false);

  const load = useCallback(async () => {
    if (isDeletingRef.current) {
      return;
    }

    const requestId = ++requestIdRef.current;
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const fetched = await getPurchase(authenticatedRequest, purchaseId);
      if (requestIdRef.current !== requestId) {
        return;
      }
      setPurchase(fetched);
    } catch (caughtError) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      // Failure keeps whatever Purchase data is already on screen - only the error text changes.
      setError(getLoadErrorMessage(caughtError));
    } finally {
      if (requestIdRef.current === requestId) {
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
      }
    }
  }, [authenticatedRequest, purchaseId]);

  // Refetches every time this screen regains focus, so a save from PurchaseEditor (which pops
  // back here) is reflected without a manual refresh step.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const deletePurchaseAction = async () => {
    if (isDeletingRef.current) {
      return;
    }

    isDeletingRef.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      await deletePurchase(authenticatedRequest, purchaseId);
      navigation.goBack();
    } catch (caughtError) {
      setError(getDeleteErrorMessage(caughtError));
    } finally {
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  };

  const confirmDelete = () => {
    if (isDeletingRef.current) {
      return;
    }

    Alert.alert('구매 기록을 삭제할까요?', '삭제한 기록은 복구할 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: deletePurchaseAction },
    ]);
  };

  if (isLoading && !purchase) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!purchase) {
    return (
      <View style={styles.loadingContainer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  const isBusy = isDeleting;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.productName}>{purchase.productName}</Text>

      <DetailRow label="구매일" value={formatDateOnlyForDisplay(purchase.purchaseDate)} />
      {purchase.amount !== null ? (
        // Verbatim decimal string from the API - no Number()/Intl.NumberFormat conversion, since a
        // value like "999999999999999.9999" is not exactly representable as a JS Number.
        <DetailRow
          label="금액"
          value={purchase.currencyCode ? `${purchase.amount} ${purchase.currencyCode}` : purchase.amount}
        />
      ) : null}
      {purchase.store ? <DetailRow label="구매처" value={purchase.store} /> : null}
      {purchase.variant ? <DetailRow label="옵션" value={purchase.variant} /> : null}
      {purchase.quantity !== null ? <DetailRow label="수량" value={purchase.quantity} /> : null}
      {purchase.memo ? <DetailRow label="메모" value={purchase.memo} /> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy }}
        disabled={isBusy}
        onPress={() =>
          navigation.navigate('PurchaseEditor', { purchaseId: purchase.id, initialPurchase: purchase })
        }
        style={[styles.editButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.editButtonLabel}>수정</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy, busy: isDeleting }}
        disabled={isBusy}
        onPress={confirmDelete}
        style={[styles.deleteButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.deleteButtonLabel}>{isDeleting ? '삭제 중...' : '삭제'}</Text>
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
  disabledButton: {
    opacity: 0.5,
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    borderRadius: 8,
    marginTop: 12,
    paddingVertical: 12,
  },
  deleteButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

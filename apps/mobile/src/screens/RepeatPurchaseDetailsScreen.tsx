import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { RootStackParamList } from '../navigation/RootStack';
import {
  deleteRepeatPurchase,
  disableRepeatPurchase,
  enableRepeatPurchase,
  getRepeatPurchase,
  type RepeatPurchase,
} from '../purchases/api/repeatPurchasesApi';
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

function getTransitionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return '다른 변경 사항이 반영되어 최신 정보를 다시 불러와야 합니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '상태를 변경할 수 없습니다.';
}

function getDeleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '반복 구매를 삭제할 수 없습니다.';
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Discards a stale in-flight load's result if a newer one has since started.
  const requestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Synchronous re-entrancy guard shared by enable/disable/delete (isTransitioning/isDeleting
  // state alone can lag one tick), and also skips a focus-triggered reload while any of them is in
  // flight - a delete is about to pop this screen either way, and an enable/disable already
  // applies the Backend's own returned DTO directly, so a concurrent GET would only race it.
  const isBusyRef = useRef(false);

  const load = useCallback(async () => {
    if (isBusyRef.current) {
      return;
    }

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

  const toggleEnabled = async () => {
    if (isBusyRef.current || !repeatPurchase) {
      return;
    }

    isBusyRef.current = true;
    setIsTransitioning(true);
    setError(null);
    try {
      // Applies the Backend's returned DTO directly - it is the only source of truth for the new
      // IsEnabled/UpdatedAtUtc/version, never flipped optimistically beforehand and never
      // requiring a follow-up GET.
      const updated = repeatPurchase.isEnabled
        ? await disableRepeatPurchase(authenticatedRequest, repeatPurchase.id)
        : await enableRepeatPurchase(authenticatedRequest, repeatPurchase.id);
      setRepeatPurchase(updated);
    } catch (caughtError) {
      // Failure leaves the existing state/version exactly as they were - never toggled locally,
      // never silently retried.
      setError(getTransitionErrorMessage(caughtError));
    } finally {
      isBusyRef.current = false;
      setIsTransitioning(false);
    }
  };

  const deleteAction = async () => {
    if (isBusyRef.current) {
      return;
    }

    isBusyRef.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteRepeatPurchase(authenticatedRequest, repeatPurchaseId);
      navigation.goBack();
    } catch (caughtError) {
      setError(getDeleteErrorMessage(caughtError));
    } finally {
      isBusyRef.current = false;
      setIsDeleting(false);
    }
  };

  const confirmDelete = () => {
    if (isBusyRef.current) {
      return;
    }

    Alert.alert(
      '반복 구매를 삭제할까요?',
      '삭제한 반복 구매는 복구할 수 없습니다. 이미 기록된 구매 이력은 삭제되지 않습니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: deleteAction },
      ],
    );
  };

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

  const isBusy = isTransitioning || isDeleting;

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
      <DetailRow label="상태" value={repeatPurchase.isEnabled ? '활성' : '일시중지'} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy }}
        disabled={isBusy}
        onPress={() =>
          navigation.navigate('RepeatPurchaseLogPurchase', {
            repeatPurchaseId: repeatPurchase.id,
            initialRepeatPurchase: repeatPurchase,
          })
        }
        style={[styles.logPurchaseButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.logPurchaseButtonLabel}>구매 완료</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy }}
        disabled={isBusy}
        onPress={() =>
          navigation.navigate('RepeatPurchaseEditor', {
            repeatPurchaseId: repeatPurchase.id,
            initialRepeatPurchase: repeatPurchase,
          })
        }
        style={[styles.editButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.editButtonLabel}>수정</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy, busy: isTransitioning }}
        disabled={isBusy}
        onPress={toggleEnabled}
        style={[styles.toggleButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.toggleButtonLabel}>
          {isTransitioning ? '처리 중...' : repeatPurchase.isEnabled ? '일시중지' : '다시 시작'}
        </Text>
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
  logPurchaseButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginTop: 24,
    paddingVertical: 12,
  },
  logPurchaseButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  editButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 12,
  },
  editButtonLabel: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
  },
  toggleButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 12,
  },
  toggleButtonLabel: {
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

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

function getLoadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('repeatPurchase.notFound');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('repeatPurchase.loadErrorFallback');
}

function getTransitionErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('repeatPurchase.conflictReload');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('repeatPurchase.transitionErrorFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('repeatPurchase.deleteErrorFallback');
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
  const { t } = useTranslation();
  const { repeatPurchaseId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();

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
      setError(getLoadErrorMessage(caughtError, t));
    } finally {
      if (requestIdRef.current === requestId) {
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
      }
    }
  }, [authenticatedRequest, repeatPurchaseId, t]);

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
      setError(getTransitionErrorMessage(caughtError, t));
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
      setError(getDeleteErrorMessage(caughtError, t));
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
      t('repeatPurchase.deleteConfirmTitle'),
      t('repeatPurchase.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: deleteAction },
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
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
      <Text style={styles.productName}>{repeatPurchase.productName}</Text>

      <DetailRow
        label={t('repeatPurchase.interval')}
        value={formatIntervalDescription(t, repeatPurchase.intervalValue, repeatPurchase.intervalUnit)}
      />
      <DetailRow
        label={t('repeatPurchase.nextPurchaseDate')}
        value={formatDateOnlyForDisplay(repeatPurchase.nextPurchaseDate)}
      />
      <DetailRow
        label={t('repeatPurchase.status')}
        value={repeatPurchase.isEnabled ? t('repeatPurchase.active') : t('repeatPurchase.paused')}
      />

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
        <Text style={styles.logPurchaseButtonLabel}>{t('nav.repeatPurchaseLogPurchase')}</Text>
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
        <Text style={styles.editButtonLabel}>{t('common.edit')}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy, busy: isTransitioning }}
        disabled={isBusy}
        onPress={toggleEnabled}
        style={[styles.toggleButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.toggleButtonLabel}>
          {isTransitioning
            ? t('common.processing')
            : repeatPurchase.isEnabled
              ? t('repeatPurchase.paused')
              : t('repeatPurchase.resume')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy, busy: isDeleting }}
        disabled={isBusy}
        onPress={confirmDelete}
        style={[styles.deleteButton, isBusy && styles.disabledButton]}
      >
        <Text style={styles.deleteButtonLabel}>
          {isDeleting ? t('common.deleting') : t('common.delete')}
        </Text>
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

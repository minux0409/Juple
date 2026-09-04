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
import { deletePurchase, getPurchase, type Purchase } from '../purchases/api/purchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseDetails'>;

function getLoadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('purchase.notFound');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('purchase.loadErrorFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('purchase.deleteErrorFallback');
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
  const { t } = useTranslation();
  const { purchaseId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();

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
      setError(getLoadErrorMessage(caughtError, t));
    } finally {
      if (requestIdRef.current === requestId) {
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
      }
    }
  }, [authenticatedRequest, purchaseId, t]);

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
      setError(getDeleteErrorMessage(caughtError, t));
    } finally {
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  };

  const confirmDelete = () => {
    if (isDeletingRef.current) {
      return;
    }

    Alert.alert(t('purchase.deleteConfirmTitle'), t('purchase.deleteConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: deletePurchaseAction },
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
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
      <Text style={styles.productName}>{purchase.productName}</Text>

      <DetailRow label={t('purchase.purchaseDate')} value={formatDateOnlyForDisplay(purchase.purchaseDate)} />
      {purchase.amount !== null ? (
        // Verbatim decimal string from the API - no Number()/Intl.NumberFormat conversion, since a
        // value like "999999999999999.9999" is not exactly representable as a JS Number.
        <DetailRow
          label={t('purchase.amount')}
          value={purchase.currencyCode ? `${purchase.amount} ${purchase.currencyCode}` : purchase.amount}
        />
      ) : null}
      {purchase.store ? <DetailRow label={t('purchase.store')} value={purchase.store} /> : null}
      {purchase.variant ? <DetailRow label={t('purchase.variant')} value={purchase.variant} /> : null}
      {purchase.quantity !== null ? (
        <DetailRow label={t('purchase.quantity')} value={purchase.quantity} />
      ) : null}
      {purchase.memo ? <DetailRow label={t('item.memo')} value={purchase.memo} /> : null}

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
        <Text style={styles.editButtonLabel}>{t('common.edit')}</Text>
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

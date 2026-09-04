import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { createPurchase, updatePurchase } from '../purchases/api/purchasesApi';
import { formatDateOnly, formatDateOnlyForDisplay, parseDateOnly } from '../purchases/dateOnly';
import {
  getLengthValidationError,
  isZeroDecimalText,
  validateOptionalDecimalText,
} from '../purchases/purchaseFieldValidation';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseEditor'>;

function getSaveErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('errors.invalidInput');
    }
    if (error.kind === 'notFound') {
      return t('purchase.itemNotFound');
    }
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('purchase.saveErrorFallback');
}

/** Mirrors the backend's PurchaseFieldsNormalizer: required, trimmed, 500-character limit. */
function getProductNameValidationError(value: string, t: TFunction): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return t('purchase.productNameRequired');
  }
  if (trimmed.length > 500) {
    return t('purchase.productNameTooLong');
  }
  return null;
}

export function PurchaseEditorScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { itemId, initialProductName, purchaseId, initialPurchase } = route.params;
  // Edit mode is set by PurchaseDetailsScreen, which always passes purchaseId and
  // initialPurchase together (see RootStackParamList) - create mode otherwise.
  const isEditMode = purchaseId !== undefined && initialPurchase !== undefined;
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();

  const [productName, setProductName] = useState(
    initialPurchase?.productName ?? initialProductName ?? '',
  );
  const [purchaseDate, setPurchaseDate] = useState(() =>
    initialPurchase ? parseDateOnly(initialPurchase.purchaseDate) : new Date(),
  );
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [amountText, setAmountText] = useState(initialPurchase?.amount ?? '');
  const [currencyCode, setCurrencyCode] = useState(initialPurchase?.currencyCode ?? '');
  const [store, setStore] = useState(initialPurchase?.store ?? '');
  const [variant, setVariant] = useState(initialPurchase?.variant ?? '');
  const [quantityText, setQuantityText] = useState(initialPurchase?.quantity ?? '');
  const [memo, setMemo] = useState(initialPurchase?.memo ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous re-entrancy guard for the submit handler (isSaving state alone can lag one tick).
  const isSavingRef = useRef(false);

  const onChangeDate = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setIsDatePickerVisible(false);
    }
    if (event.type === 'set' && selected) {
      setPurchaseDate(selected);
    }
  };

  const submit = async () => {
    if (isSavingRef.current) {
      return;
    }

    const productNameError = getProductNameValidationError(productName, t);
    if (productNameError) {
      setError(productNameError);
      return;
    }
    const trimmedProductName = productName.trim();

    const validatedAmount = validateOptionalDecimalText(amountText);
    if (validatedAmount === 'invalid') {
      setError(t('purchase.amountInvalid'));
      return;
    }

    const trimmedCurrencyCode = currencyCode.trim().toUpperCase();
    if (validatedAmount !== null && !/^[A-Z]{3}$/.test(trimmedCurrencyCode)) {
      setError(t('purchase.currencyCodeInvalid'));
      return;
    }
    if (validatedAmount === null && trimmedCurrencyCode) {
      setError(t('purchase.currencyCodeRequiresAmount'));
      return;
    }

    const validatedQuantity = validateOptionalDecimalText(quantityText);
    if (validatedQuantity === 'invalid') {
      setError(t('purchase.quantityInvalid'));
      return;
    }
    if (validatedQuantity !== null && isZeroDecimalText(validatedQuantity)) {
      setError(t('purchase.quantityMustBePositive'));
      return;
    }

    const storeError = getLengthValidationError(store, t('purchase.store'), 200, t);
    if (storeError) {
      setError(storeError);
      return;
    }
    const variantError = getLengthValidationError(variant, t('purchase.variant'), 200, t);
    if (variantError) {
      setError(variantError);
      return;
    }
    if (memo.length > 4000) {
      setError(t('purchase.memoTooLong'));
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const fields = {
        productName: trimmedProductName,
        purchaseDate: formatDateOnly(purchaseDate),
        amount: validatedAmount,
        currencyCode: validatedAmount !== null ? trimmedCurrencyCode : null,
        store: store.trim() || null,
        variant: variant.trim() || null,
        quantity: validatedQuantity,
        // Only a genuinely empty Memo collapses to null - otherwise preserved verbatim, matching
        // the backend's Memo convention (whitespace/linebreaks are a deliberate user entry).
        memo: memo || null,
      };

      if (isEditMode) {
        // ItemId is never re-derived here - it stays whatever the Purchase already had (including
        // null), since this screen has no Item picker/search (out of scope for this iteration).
        await updatePurchase(authenticatedRequest, purchaseId, {
          itemId: initialPurchase.itemId,
          ...fields,
        });
      } else {
        await createPurchase(authenticatedRequest, { itemId: itemId ?? null, ...fields });
      }
      navigation.goBack();
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError, t));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>{t('purchase.productName')}</Text>
      <TextInput
        onChangeText={setProductName}
        placeholder={t('purchase.productNamePlaceholder')}
        style={styles.input}
        value={productName}
      />

      <Text style={styles.label}>{t('purchase.purchaseDate')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setIsDatePickerVisible(true)}
        style={styles.dateButton}
      >
        <Text style={styles.dateButtonLabel}>
          {formatDateOnlyForDisplay(formatDateOnly(purchaseDate))}
        </Text>
      </Pressable>
      {isDatePickerVisible ? (
        <DateTimePicker mode="date" onChange={onChangeDate} value={purchaseDate} />
      ) : null}

      <Text style={styles.label}>{t('purchase.amount')}</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setAmountText}
        placeholder={t('purchase.amountPlaceholder')}
        style={styles.input}
        value={amountText}
      />

      <Text style={styles.label}>{t('purchase.currencyCode')}</Text>
      <TextInput
        autoCapitalize="characters"
        maxLength={3}
        onChangeText={text => setCurrencyCode(text.toUpperCase())}
        placeholder={t('purchase.currencyCodePlaceholder')}
        style={styles.input}
        value={currencyCode}
      />

      <Text style={styles.label}>{t('purchase.store')}</Text>
      <TextInput
        onChangeText={setStore}
        placeholder={t('purchase.storePlaceholder')}
        style={styles.input}
        value={store}
      />

      <Text style={styles.label}>{t('purchase.variant')}</Text>
      <TextInput
        onChangeText={setVariant}
        placeholder={t('purchase.variantPlaceholder')}
        style={styles.input}
        value={variant}
      />

      <Text style={styles.label}>{t('purchase.quantity')}</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setQuantityText}
        placeholder={t('purchase.quantityPlaceholder')}
        style={styles.input}
        value={quantityText}
      />

      <Text style={styles.label}>{t('item.memo')}</Text>
      <TextInput
        multiline
        onChangeText={setMemo}
        placeholder={t('item.memoPlaceholder')}
        style={styles.memoInput}
        value={memo}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isSaving, busy: isSaving }}
        disabled={isSaving}
        onPress={submit}
        style={[styles.saveButton, isSaving && styles.disabledButton]}
      >
        <Text style={styles.saveButtonLabel}>{isSaving ? t('common.saving') : t('common.save')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    marginTop: 20,
    marginBottom: 6,
  },
  input: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  memoInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  dateButton: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateButtonLabel: {
    color: '#111111',
    fontSize: 16,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 16,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginTop: 24,
    paddingVertical: 12,
  },
  disabledButton: {
    opacity: 0.5,
  },
  saveButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

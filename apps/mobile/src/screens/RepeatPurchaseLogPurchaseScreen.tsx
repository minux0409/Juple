import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { logRepeatPurchase } from '../purchases/api/repeatPurchasesApi';
import { formatDateOnly, formatDateOnlyForDisplay } from '../purchases/dateOnly';
import {
  getLengthValidationError,
  isZeroDecimalText,
  validateOptionalDecimalText,
} from '../purchases/purchaseFieldValidation';

type Props = NativeStackScreenProps<RootStackParamList, 'RepeatPurchaseLogPurchase'>;

function getLogPurchaseErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('errors.invalidInput');
    }
    if (error.kind === 'notFound') {
      return t('repeatPurchase.notFound');
    }
    if (error.kind === 'conflict') {
      // Same principle as RepeatPurchase Edit's stale-version 409: never silently retried or
      // overwritten, and never assume the Purchase was created - the user must go back and reopen
      // with the latest data.
      return t('repeatPurchase.conflictReload');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('repeatPurchase.logPurchaseErrorFallback');
}

export function RepeatPurchaseLogPurchaseScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { repeatPurchaseId, initialRepeatPurchase } = route.params;
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();

  // Device-local today, via the same DateOnly utility as PurchaseEditor - never
  // toISOString()/new Date("YYYY-MM-DD") (UTC parsing).
  const [purchaseDate, setPurchaseDate] = useState(() => new Date());
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [store, setStore] = useState('');
  const [variant, setVariant] = useState('');
  const [quantityText, setQuantityText] = useState('');
  const [memo, setMemo] = useState('');
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
      // No productName/itemId sent - the Backend derives them from the RepeatPurchase itself (see
      // repeatPurchasesApi.LogRepeatPurchaseInput). Only the just-loaded RepeatPurchaseDetails
      // version is round-tripped; a stale value 409s rather than silently overwriting.
      await logRepeatPurchase(authenticatedRequest, repeatPurchaseId, {
        version: initialRepeatPurchase.version,
        purchaseDate: formatDateOnly(purchaseDate),
        amount: validatedAmount,
        currencyCode: validatedAmount !== null ? trimmedCurrencyCode : null,
        store: store.trim() || null,
        variant: variant.trim() || null,
        quantity: validatedQuantity,
        memo: memo || null,
      });
      // RepeatPurchaseDetailsScreen already refetches on every focus (see its useFocusEffect), so
      // popping back here reflects the new NextPurchaseDate/version without any extra plumbing -
      // the same mechanism already used by RepeatPurchaseEditor's own save-and-return flow.
      navigation.goBack();
    } catch (caughtError) {
      // Failure leaves every field exactly as typed - never cleared, never navigated away.
      setError(getLogPurchaseErrorMessage(caughtError, t));
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
      <Text style={styles.productName}>{initialRepeatPurchase.productName}</Text>

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
        <Text style={styles.saveButtonLabel}>
          {isSaving ? t('common.saving') : t('nav.repeatPurchaseLogPurchase')}
        </Text>
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
  productName: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
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

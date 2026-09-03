import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
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

function getLogPurchaseErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return '입력한 내용을 확인해 주세요.';
    }
    if (error.kind === 'notFound') {
      return '이미 삭제되었거나 찾을 수 없는 반복 구매입니다.';
    }
    if (error.kind === 'conflict') {
      // Same principle as RepeatPurchase Edit's stale-version 409: never silently retried or
      // overwritten, and never assume the Purchase was created - the user must go back and reopen
      // with the latest data.
      return '다른 변경 사항이 반영되어 최신 정보를 다시 불러와야 합니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '구매를 기록할 수 없습니다.';
}

export function RepeatPurchaseLogPurchaseScreen({ route, navigation }: Props) {
  const { repeatPurchaseId, initialRepeatPurchase } = route.params;
  const authenticatedRequest = useAuthenticatedApi();

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
      setError('금액을 올바르게 입력해 주세요.');
      return;
    }

    const trimmedCurrencyCode = currencyCode.trim().toUpperCase();
    if (validatedAmount !== null && !/^[A-Z]{3}$/.test(trimmedCurrencyCode)) {
      setError('통화 코드는 알파벳 3자리로 입력해 주세요 (예: KRW).');
      return;
    }
    if (validatedAmount === null && trimmedCurrencyCode) {
      setError('통화 코드를 입력하려면 금액도 함께 입력해 주세요.');
      return;
    }

    const validatedQuantity = validateOptionalDecimalText(quantityText);
    if (validatedQuantity === 'invalid') {
      setError('수량을 올바르게 입력해 주세요.');
      return;
    }
    if (validatedQuantity !== null && isZeroDecimalText(validatedQuantity)) {
      setError('수량은 0보다 커야 합니다.');
      return;
    }

    const storeError = getLengthValidationError(store, '구매처', 200);
    if (storeError) {
      setError(storeError);
      return;
    }
    const variantError = getLengthValidationError(variant, '옵션', 200);
    if (variantError) {
      setError(variantError);
      return;
    }
    if (memo.length > 4000) {
      setError('메모는 4000자 이하로 입력해 주세요.');
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
      setError(getLogPurchaseErrorMessage(caughtError));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>상품명</Text>
      <Text style={styles.productName}>{initialRepeatPurchase.productName}</Text>

      <Text style={styles.label}>구매일</Text>
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

      <Text style={styles.label}>금액</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setAmountText}
        placeholder="예: 19900"
        style={styles.input}
        value={amountText}
      />

      <Text style={styles.label}>통화 코드</Text>
      <TextInput
        autoCapitalize="characters"
        maxLength={3}
        onChangeText={text => setCurrencyCode(text.toUpperCase())}
        placeholder="예: KRW"
        style={styles.input}
        value={currencyCode}
      />

      <Text style={styles.label}>구매처</Text>
      <TextInput
        onChangeText={setStore}
        placeholder="예: Coupang"
        style={styles.input}
        value={store}
      />

      <Text style={styles.label}>옵션</Text>
      <TextInput
        onChangeText={setVariant}
        placeholder="예: 250ml / Blue"
        style={styles.input}
        value={variant}
      />

      <Text style={styles.label}>수량</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setQuantityText}
        placeholder="예: 1"
        style={styles.input}
        value={quantityText}
      />

      <Text style={styles.label}>메모</Text>
      <TextInput
        multiline
        onChangeText={setMemo}
        placeholder="메모를 입력해 주세요"
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
        <Text style={styles.saveButtonLabel}>{isSaving ? '저장 중...' : '구매 완료'}</Text>
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

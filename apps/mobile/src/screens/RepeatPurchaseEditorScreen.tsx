import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { RootStackParamList } from '../navigation/RootStack';
import {
  createRepeatPurchase,
  updateRepeatPurchase,
  type IntervalUnit,
} from '../purchases/api/repeatPurchasesApi';
import { formatDateOnly, formatDateOnlyForDisplay, parseDateOnly } from '../purchases/dateOnly';

type Props = NativeStackScreenProps<RootStackParamList, 'RepeatPurchaseEditor'>;

const INTERVAL_UNIT_OPTIONS: ReadonlyArray<{ value: IntervalUnit; label: string }> = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
  { value: 'month', label: '개월' },
];

function getSaveErrorMessage(error: unknown, isEditMode: boolean): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return '입력한 내용을 확인해 주세요.';
    }
    if (error.kind === 'notFound') {
      return isEditMode
        ? '이미 삭제되었거나 찾을 수 없는 반복 구매입니다.'
        : '연결된 항목을 찾을 수 없습니다.';
    }
    if (error.kind === 'conflict') {
      // Update's only realistic 409 cause is a stale RowVersion (bootstrap-incomplete would
      // already have surfaced when this screen's initial data loaded) - never silently retried or
      // overwritten, the user must go back and reopen with the latest data.
      return isEditMode
        ? '다른 변경 사항이 반영되어 최신 정보를 다시 불러와야 합니다. 뒤로 가서 다시 시도해 주세요.'
        : 'Juple 계정 준비 상태를 확인할 수 없습니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '반복 구매를 저장할 수 없습니다.';
}

/** Mirrors the backend's RepeatPurchaseFieldsNormalizer: required, trimmed, 500-character limit. */
function getProductNameValidationError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return '상품명을 입력해 주세요.';
  }
  if (trimmed.length > 500) {
    return '상품명은 500자 이하로 입력해 주세요.';
  }
  return null;
}

/**
 * IntervalValue is a genuine positive integer field (unlike Purchase's Amount/Quantity, which stay
 * opaque decimal strings end to end) - converting it to a number here is safe and expected.
 * Deterministic and regex-gated (digits only) rather than a bare Number()/parseInt() call, so
 * "1.5", "1e3", or other non-integer text can never slip through.
 */
function validateIntervalValueText(text: string): number | 'invalid' {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 'invalid';
  }
  const parsed = Number(trimmed);
  return parsed > 0 && Number.isSafeInteger(parsed) ? parsed : 'invalid';
}

export function RepeatPurchaseEditorScreen({ route, navigation }: Props) {
  const { itemId, repeatPurchaseId, initialRepeatPurchase } = route.params;
  // Edit mode is set by RepeatPurchaseDetailsScreen, which always passes repeatPurchaseId and
  // initialRepeatPurchase together (see RootStackParamList) - create mode otherwise.
  const isEditMode = repeatPurchaseId !== undefined && initialRepeatPurchase !== undefined;
  const authenticatedRequest = useAuthenticatedApi();

  const [productName, setProductName] = useState(initialRepeatPurchase?.productName ?? '');
  const [intervalValueText, setIntervalValueText] = useState(
    initialRepeatPurchase ? String(initialRepeatPurchase.intervalValue) : '',
  );
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    initialRepeatPurchase?.intervalUnit ?? 'day',
  );
  const [nextPurchaseDate, setNextPurchaseDate] = useState(() =>
    initialRepeatPurchase ? parseDateOnly(initialRepeatPurchase.nextPurchaseDate) : new Date(),
  );
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous re-entrancy guard for the submit handler (isSaving state alone can lag one tick).
  const isSavingRef = useRef(false);

  const onChangeDate = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setIsDatePickerVisible(false);
    }
    if (event.type === 'set' && selected) {
      setNextPurchaseDate(selected);
    }
  };

  const submit = async () => {
    if (isSavingRef.current) {
      return;
    }

    const productNameError = getProductNameValidationError(productName);
    if (productNameError) {
      setError(productNameError);
      return;
    }
    const trimmedProductName = productName.trim();

    const validatedIntervalValue = validateIntervalValueText(intervalValueText);
    if (validatedIntervalValue === 'invalid') {
      setError('주기는 1 이상의 정수로 입력해 주세요.');
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      if (isEditMode) {
        // ItemId is never re-derived here - it stays whatever the RepeatPurchase already had
        // (including null), since this screen has no Item picker/search (out of scope for this
        // iteration). NextPurchaseDate is saved exactly as entered - changing IntervalValue/Unit
        // never silently recomputes it; the user's explicit date always wins.
        await updateRepeatPurchase(authenticatedRequest, repeatPurchaseId, {
          itemId: initialRepeatPurchase.itemId,
          productName: trimmedProductName,
          intervalValue: validatedIntervalValue,
          intervalUnit,
          nextPurchaseDate: formatDateOnly(nextPurchaseDate),
          // Reminder has no UI yet - preserved exactly as it already was, never reset to
          // false/0, so a future Notification UI can still edit whatever the user already set.
          isReminderEnabled: initialRepeatPurchase.isReminderEnabled,
          reminderLeadDays: initialRepeatPurchase.reminderLeadDays,
          version: initialRepeatPurchase.version,
        });
      } else {
        await createRepeatPurchase(authenticatedRequest, {
          itemId: itemId ?? null,
          productName: trimmedProductName,
          intervalValue: validatedIntervalValue,
          intervalUnit,
          nextPurchaseDate: formatDateOnly(nextPurchaseDate),
          isReminderEnabled: false,
          reminderLeadDays: 0,
        });
      }
      navigation.goBack();
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError, isEditMode));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>상품명</Text>
      <TextInput
        onChangeText={setProductName}
        placeholder="상품명을 입력해 주세요"
        style={styles.input}
        value={productName}
      />

      <Text style={styles.label}>주기</Text>
      <View style={styles.intervalRow}>
        <TextInput
          keyboardType="number-pad"
          onChangeText={setIntervalValueText}
          placeholder="예: 30"
          style={[styles.input, styles.intervalValueInput]}
          value={intervalValueText}
        />
        <View style={styles.intervalUnitRow}>
          {INTERVAL_UNIT_OPTIONS.map(option => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: intervalUnit === option.value }}
              onPress={() => setIntervalUnit(option.value)}
              style={[
                styles.intervalUnitButton,
                intervalUnit === option.value && styles.intervalUnitButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.intervalUnitLabel,
                  intervalUnit === option.value && styles.intervalUnitLabelActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.label}>다음 예상 구매일</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setIsDatePickerVisible(true)}
        style={styles.dateButton}
      >
        <Text style={styles.dateButtonLabel}>
          {formatDateOnlyForDisplay(formatDateOnly(nextPurchaseDate))}
        </Text>
      </Pressable>
      {isDatePickerVisible ? (
        <DateTimePicker mode="date" onChange={onChangeDate} value={nextPurchaseDate} />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isSaving, busy: isSaving }}
        disabled={isSaving}
        onPress={submit}
        style={[styles.saveButton, isSaving && styles.disabledButton]}
      >
        <Text style={styles.saveButtonLabel}>{isSaving ? '저장 중...' : '저장'}</Text>
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
  intervalRow: {
    flexDirection: 'row',
  },
  intervalValueInput: {
    flex: 1,
    marginRight: 8,
  },
  intervalUnitRow: {
    flexDirection: 'row',
  },
  intervalUnitButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    marginLeft: 8,
    paddingHorizontal: 14,
  },
  intervalUnitButtonActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  intervalUnitLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  intervalUnitLabelActive: {
    color: '#FFFFFF',
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

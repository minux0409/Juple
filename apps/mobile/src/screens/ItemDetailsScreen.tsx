import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemDetails, updateItemDetails, type ItemDetails } from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetails'>;

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '항목을 불러올 수 없습니다.';
}

function getSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return '입력한 내용을 확인해 주세요.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '변경 사항을 저장할 수 없습니다.';
}

export function ItemDetailsScreen({ route, navigation }: Props) {
  const { itemId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();

  const [item, setItem] = useState<ItemDetails | null>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [baselineTitle, setBaselineTitle] = useState('');
  const [baselineMemo, setBaselineMemo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const isSavingRef = useRef(isSaving);
  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const details = await getItemDetails(authenticatedRequest, itemId);
      setItem(details);
      setTitle(details.title ?? '');
      setMemo(details.memo ?? '');
      setBaselineTitle(details.title ?? '');
      setBaselineMemo(details.memo ?? '');
    } catch (caughtError) {
      setError(getLoadErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, itemId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const isDirty = title !== baselineTitle || memo !== baselineMemo;

  usePreventRemove(isDirty, ({ data }) => {
    Alert.alert(
      '저장하지 않은 변경 사항',
      '저장하지 않고 나가면 변경 사항이 사라집니다.',
      [
        { text: '계속 편집', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  const save = async () => {
    if (isSavingRef.current || !isDirty) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      await updateItemDetails(authenticatedRequest, itemId, { title, memo });
      setBaselineTitle(title);
      setBaselineMemo(memo);
      setJustSaved(true);
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading && !item) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.loadingContainer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>제목</Text>
      <TextInput
        onChangeText={text => {
          setTitle(text);
          setJustSaved(false);
        }}
        placeholder="제목을 입력해 주세요"
        style={styles.titleInput}
        value={title}
      />

      <Text style={styles.label}>URL</Text>
      <Text selectable style={styles.url}>
        {item.url}
      </Text>

      <Text style={styles.label}>메모</Text>
      <TextInput
        multiline
        onChangeText={text => {
          setMemo(text);
          setJustSaved(false);
        }}
        placeholder="메모를 입력해 주세요"
        style={styles.memoInput}
        value={memo}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {justSaved && !isDirty ? <Text style={styles.savedMessage}>저장되었습니다.</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !isDirty || isSaving, busy: isSaving }}
        disabled={!isDirty || isSaving}
        onPress={save}
        style={[styles.saveButton, (!isDirty || isSaving) && styles.disabledButton]}
      >
        <Text style={styles.saveButtonLabel}>{isSaving ? '저장 중...' : '저장'}</Text>
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
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    marginTop: 20,
    marginBottom: 6,
  },
  titleInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  url: {
    color: '#111111',
    fontSize: 14,
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
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 16,
  },
  savedMessage: {
    color: '#0F7A3D',
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

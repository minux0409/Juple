import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { LoadFailureState } from '../components/LoadFailureState';
import { RefreshFailureNotice } from '../components/RefreshFailureNotice';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useMessageDialog } from '../components/useMessageDialog';
import { ChevronIcon } from '../icons/ChevronIcon';
import { InfoIcon } from '../icons/InfoIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { getSupportDiagnostics } from '../support/appInfo';
import {
  createSupportInquiry,
  SUPPORT_INQUIRY_MAX_LENGTH,
  type SupportInquiry,
  type SupportInquiryType,
} from '../support/api/supportInquiryApi';
import { formatInquiryDateTime, inquiryStatusLabel, inquiryTypeLabel } from '../support/inquiryFormat';
import { InquiryTypePickerDialog } from '../support/InquiryTypePickerDialog';
import { useSupportInquiryHistory } from '../support/useSupportInquiryHistory';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

type InquiryTab = 'write' | 'history';

/**
 * 문의하기: two tabs - write an inquiry (type + text, sent in the app, never by mail) and 문의내역 (what was sent,
 * newest first, with the answers). A failed send keeps the draft; a successful one clears it only after the server
 * answered, says so in the common dialog and then shows the history with the new inquiry on top.
 */
export function SupportInquiryScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'SupportInquiry'>>();
  const request = useAuthenticatedApi();
  const { showMessage, messageDialog } = useMessageDialog();
  const [tab, setTab] = useState<InquiryTab>(route.params?.initialTab ?? 'write');
  const history = useSupportInquiryHistory(tab === 'history');

  const [type, setType] = useState<SupportInquiryType | null>(null);
  const [content, setContent] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  // One id per submission: a retry of the SAME type + text reuses it (the server then returns the same inquiry
  // instead of a duplicate); changing the draft starts a new submission.
  const attemptRef = useRef<{ id: string; type: SupportInquiryType; content: string } | null>(null);

  const trimmed = content.trim();
  const canSubmit = type !== null && trimmed.length > 0 && trimmed.length <= SUPPORT_INQUIRY_MAX_LENGTH && !isSubmitting;

  const submit = async () => {
    if (!canSubmit || type === null || isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    const previous = attemptRef.current;
    const attempt = previous && previous.type === type && previous.content === trimmed ? previous : { id: uuidv4(), type, content: trimmed };
    attemptRef.current = attempt;
    try {
      const created = await createSupportInquiry(request, {
        clientRequestId: attempt.id,
        type,
        content: trimmed,
        diagnostics: getSupportDiagnostics(),
      });
      // Only now, with the server's answer in hand, is the draft let go.
      attemptRef.current = null;
      setType(null);
      setContent('');
      history.prepend(created);
      showMessage(t('inquiry.successMessage'), {
        onDone: () => {
          setTab('history');
          history.refresh().catch(() => undefined);
        },
      });
    } catch {
      // The draft stays exactly as typed; sending again is possible at once.
      showMessage(t('inquiry.submitFailed'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(['write', 'history'] as const).map(candidate => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === candidate }}
            key={candidate}
            onPress={() => setTab(candidate)}
            style={[styles.tab, tab === candidate && styles.tabSelected]}
            testID={`inquiry-tab-${candidate}`}
          >
            <Text numberOfLines={1} style={[styles.tabLabel, tab === candidate && styles.tabLabelSelected]}>
              {t(candidate === 'write' ? 'inquiry.tabWrite' : 'inquiry.tabHistory')}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'write' ? (
        <KeyboardSafeView style={styles.flex}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" testID="inquiry-form">
            <Text style={styles.fieldLabel}>
              {t('inquiry.typeLabel')} <Text accessibilityLabel={t('inquiry.required')} style={styles.required}>*</Text>
            </Text>
            <Pressable
              accessibilityLabel={`${t('inquiry.typeLabel')}, ${t('inquiry.required')}, ${type ? inquiryTypeLabel(t, type) : t('inquiry.typePlaceholder')}`}
              accessibilityRole="button"
              onPress={() => setIsPickerOpen(true)}
              style={styles.selectField}
              testID="inquiry-type-field"
            >
              <Text numberOfLines={1} style={[styles.selectText, !type && styles.placeholder]}>
                {type ? inquiryTypeLabel(t, type) : t('inquiry.typePlaceholder')}
              </Text>
              <ChevronIcon color={colors.textSecondary} direction="down" size={18} />
            </Pressable>

            <Text style={[styles.fieldLabel, styles.contentLabel]}>
              {t('inquiry.contentLabel')} <Text accessibilityLabel={t('inquiry.required')} style={styles.required}>*</Text>
            </Text>
            <TextInput
              accessibilityLabel={`${t('inquiry.contentLabel')}, ${t('inquiry.required')}`}
              editable={!isSubmitting}
              maxLength={SUPPORT_INQUIRY_MAX_LENGTH}
              multiline
              onChangeText={setContent}
              placeholder={t('inquiry.contentPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={styles.contentInput}
              testID="inquiry-content"
              textAlignVertical="top"
              value={content}
            />
            <Text style={styles.counter} testID="inquiry-counter">{t('inquiry.counter', { count: content.length, max: SUPPORT_INQUIRY_MAX_LENGTH })}</Text>

            <View style={styles.notes}>
              {[t('inquiry.helpNote1'), t('inquiry.helpNote2')].map(note => (
                <View key={note} style={styles.noteRow}>
                  <InfoIcon color={colors.textSecondary} size={16} />
                  <Text style={styles.noteText}>{note}</Text>
                </View>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
              disabled={!canSubmit}
              onPress={() => { submit().catch(() => undefined); }}
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              testID="inquiry-submit"
            >
              {isSubmitting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.submitLabel}>{t('inquiry.submit')}</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardSafeView>
      ) : (
        <InquiryHistory
          history={history}
          onOpen={inquiry => navigation.navigate('SupportInquiryDetail', { inquiryId: inquiry.inquiryId })}
        />
      )}

      <InquiryTypePickerDialog
        onClose={() => setIsPickerOpen(false)}
        onSelect={selected => {
          setType(selected);
          setIsPickerOpen(false);
        }}
        selected={type}
        visible={isPickerOpen}
      />
      {messageDialog}
    </StackScreenSafeArea>
  );
}

function InquiryHistory({ history, onOpen }: { readonly history: ReturnType<typeof useSupportInquiryHistory>; readonly onOpen: (inquiry: SupportInquiry) => void }) {
  const { t } = useTranslation();

  if (history.loadError !== null && history.items.length === 0) {
    return <LoadFailureState error={history.loadError} onRetry={() => { history.refresh().catch(() => undefined); }} testID="inquiry-history-error" />;
  }
  if (history.isLoading && history.items.length === 0) {
    return <ActivityIndicator style={styles.loading} testID="inquiry-history-loading" />;
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={history.items}
      keyExtractor={item => String(item.inquiryId)}
      ListEmptyComponent={<CenteredEmptyState message={t('inquiry.historyEmpty')} />}
      ListFooterComponent={
        history.isLoadingMore ? (
          <ActivityIndicator style={styles.footerLoading} testID="inquiry-history-more" />
        ) : history.noticeError ? (
          <RefreshFailureNotice onRetry={() => { (history.hasMore ? history.loadMore() : history.refresh()).catch(() => undefined); }} testID="inquiry-history-notice" />
        ) : undefined
      }
      onEndReached={() => { history.loadMore().catch(() => undefined); }}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl onRefresh={() => { history.refresh().catch(() => undefined); }} refreshing={history.isRefreshing} />}
      renderItem={({ item }) => <InquiryRow inquiry={item} onPress={() => onOpen(item)} />}
      testID="inquiry-history"
    />
  );
}

function InquiryRow({ inquiry, onPress }: { readonly inquiry: SupportInquiry; readonly onPress: () => void }) {
  const { t } = useTranslation();
  const typeLabel = inquiryTypeLabel(t, inquiry.type);
  const statusLabel = inquiryStatusLabel(t, inquiry.status);
  const date = formatInquiryDateTime(inquiry.createdAtUtc);
  return (
    <Pressable
      accessibilityLabel={t('inquiry.rowA11y', { type: typeLabel, status: statusLabel, date, content: inquiry.content })}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={`inquiry-row-${inquiry.inquiryId}`}
    >
      <View style={styles.rowHeader}>
        <Text numberOfLines={1} style={styles.rowType}>{typeLabel}</Text>
        <Text style={[styles.rowStatus, inquiry.status === 'Answered' && styles.rowStatusAnswered]} testID={`inquiry-status-${inquiry.inquiryId}`}>{statusLabel}</Text>
      </View>
      <Text numberOfLines={2} style={styles.rowContent}>{inquiry.content}</Text>
      <Text style={styles.rowDate}>{date}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  tabs: { alignSelf: 'center', flexDirection: 'row', maxWidth: 640, paddingHorizontal: spacing.xl, paddingTop: spacing.md, width: '100%' },
  tab: { alignItems: 'center', borderBottomColor: colors.inputBorder, borderBottomWidth: 2, flex: 1, justifyContent: 'center', minHeight: minTouchTarget },
  tabSelected: { borderBottomColor: colors.brand },
  tabLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  tabLabelSelected: { color: colors.brand, fontWeight: '700' },
  form: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, width: '100%' },
  fieldLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: spacing.sm },
  contentLabel: { marginTop: spacing.xl },
  required: { color: colors.danger },
  selectField: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.md, borderWidth: 1, columnGap: spacing.sm, flexDirection: 'row', minHeight: minTouchTarget + 4, paddingHorizontal: spacing.md },
  selectText: { color: colors.textPrimary, flex: 1, fontSize: 15 },
  placeholder: { color: colors.textSecondary },
  contentInput: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontSize: 15, lineHeight: 22, maxHeight: 320, minHeight: 180, padding: spacing.md },
  counter: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs, textAlign: 'right' },
  notes: { marginTop: spacing.lg, rowGap: spacing.sm },
  noteRow: { alignItems: 'flex-start', columnGap: spacing.sm, flexDirection: 'row' },
  noteText: { color: colors.textSecondary, flex: 1, fontSize: 13, lineHeight: 19 },
  submit: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget + 4, paddingHorizontal: spacing.lg },
  submitDisabled: { opacity: 0.45 },
  submitLabel: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  loading: { marginTop: spacing.xl },
  footerLoading: { marginVertical: spacing.lg },
  list: { alignSelf: 'center', flexGrow: 1, maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  row: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.sm + 2, padding: spacing.md, ...cardShadow },
  rowHeader: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  rowType: { color: colors.textSecondary, flex: 1, fontSize: 13, fontWeight: '700' },
  rowStatus: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  rowStatusAnswered: { color: colors.brand },
  rowContent: { color: colors.textPrimary, fontSize: 15, lineHeight: 21, marginTop: spacing.xs },
  rowDate: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.sm },
});

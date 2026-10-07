import { useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import type { RootStackParamList } from '../navigation/RootStack';
import { getSupportInquiry, type SupportInquiry } from '../support/api/supportInquiryApi';
import { formatInquiryDateTime, inquiryStatusLabel, inquiryTypeLabel } from '../support/inquiryFormat';
import { cardShadow, colors, radii, spacing } from '../theme/tokens';

/**
 * 문의 상세: one inquiry in full, readable top to bottom - its type and status, what was asked and when, then the
 * answer (or that it is awaited). Read-only: no edit and no delete. Diagnostics are never shown. An id that is not
 * the signed-in user's is the same "not found" as one that does not exist.
 */
export function SupportInquiryDetailScreen() {
  const { t } = useTranslation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'SupportInquiryDetail'>>();
  const request = useAuthenticatedApi();
  const [inquiry, setInquiry] = useState<SupportInquiry | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await getSupportInquiry(request, params.inquiryId);
      if (requestId === requestIdRef.current) {
        setInquiry(loaded);
      }
    } catch (caught) {
      if (requestId === requestIdRef.current) {
        setError(caught);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [params.inquiryId, request]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (isLoading && !inquiry) {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <ActivityIndicator style={styles.loading} testID="inquiry-detail-loading" />
      </StackScreenSafeArea>
    );
  }

  if (!inquiry) {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <LoadFailureState
          error={error}
          notice={error instanceof ApiError && error.kind === 'notFound' ? t('inquiry.notFound') : null}
          onRetry={() => { load().catch(() => undefined); }}
          testID="inquiry-detail-error"
        />
      </StackScreenSafeArea>
    );
  }

  const isAnswered = inquiry.status === 'Answered';
  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} testID="inquiry-detail">
        <View style={styles.badges}>
          <Text style={styles.typeBadge} testID="inquiry-detail-type">{inquiryTypeLabel(t, inquiry.type)}</Text>
          <Text style={[styles.statusBadge, isAnswered && styles.statusBadgeAnswered]} testID="inquiry-detail-status">{inquiryStatusLabel(t, inquiry.status)}</Text>
        </View>

        <Text accessibilityRole="header" style={styles.heading}>{t('inquiry.contentHeading')}</Text>
        <View style={styles.card}>
          <Text selectable style={styles.body} testID="inquiry-detail-content">{inquiry.content}</Text>
        </View>
        <Text style={styles.meta}>{t('inquiry.receivedAt')}</Text>
        <Text style={styles.metaValue} testID="inquiry-detail-created">{formatInquiryDateTime(inquiry.createdAtUtc)}</Text>

        <Text accessibilityRole="header" style={[styles.heading, styles.answerHeading]}>{t('inquiry.answerHeading')}</Text>
        <View style={styles.card}>
          {isAnswered && inquiry.answer ? (
            <Text selectable style={styles.body} testID="inquiry-detail-answer">{inquiry.answer}</Text>
          ) : (
            <Text style={styles.waiting} testID="inquiry-detail-waiting">{t('inquiry.awaitingAnswer')}</Text>
          )}
        </View>
        {isAnswered && inquiry.answeredAtUtc ? (
          <>
            <Text style={styles.meta}>{t('inquiry.answeredAt')}</Text>
            <Text style={styles.metaValue} testID="inquiry-detail-answered">{formatInquiryDateTime(inquiry.answeredAtUtc)}</Text>
          </>
        ) : null}
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  loading: { marginTop: spacing.xl },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, width: '100%' },
  badges: { columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xs },
  typeBadge: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, color: colors.textPrimary, fontSize: 13, fontWeight: '700', overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  statusBadge: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, color: colors.textSecondary, fontSize: 13, fontWeight: '700', overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  statusBadgeAnswered: { color: colors.brand },
  heading: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: spacing.sm, marginTop: spacing.xl },
  answerHeading: { marginTop: spacing.xl + spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, ...cardShadow },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 23 },
  waiting: { color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
  meta: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: spacing.md },
  metaValue: { color: colors.textPrimary, fontSize: 13, marginTop: 2 },
});

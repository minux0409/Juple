import { useRoute, type RouteProp, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { LoadFailureState } from '../components/LoadFailureState';
import { Pressable } from '../components/Pressable';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import type { RootStackParamList } from '../navigation/RootStack';
import { acknowledgeModerationNotice, getModerationNotice, type ModerationNotice } from '../safety/moderationNoticeApi';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

/**
 * 이용 안내 (an operator's reviewed warning) or the result of the person's own report. Opened from the Inbox or a push tap; it stays readable
 * after a re-login (it lives on the server) and remembers that it was confirmed. The words are the operator's, shown as plain text - the
 * report itself (who reported, what they wrote) is never part of it.
 */
export function ModerationNoticeScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'ModerationNotice'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const [notice, setNotice] = useState<ModerationNotice | null>(null);
  const [failed, setFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getModerationNotice(request, params.noticeId).then(
      value => {
        setNotice(value);
        setFailed(value === null);
      },
      () => setFailed(true),
    );
  }, [params.noticeId, request]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async () => {
    if (isSaving || notice === null) {
      return;
    }
    setIsSaving(true);
    setSaveFailed(false);
    try {
      await acknowledgeModerationNotice(request, notice.id);
      setNotice({ ...notice, acknowledgedAtUtc: notice.acknowledgedAtUtc ?? new Date().toISOString() });
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    } catch {
      setSaveFailed(true);
    } finally {
      setIsSaving(false);
    }
  };

  if (failed) {
    return (
      <StackScreenSafeArea>
        <LoadFailureState onRetry={load} testID="moderation-notice-error" />
      </StackScreenSafeArea>
    );
  }
  if (notice === null) {
    return (
      <StackScreenSafeArea>
        <ActivityIndicator style={styles.loading} testID="moderation-notice-loading" />
      </StackScreenSafeArea>
    );
  }

  const isWarning = notice.kind === 'warning';
  const isAcknowledged = notice.acknowledgedAtUtc !== null;
  return (
    <StackScreenSafeArea>
      <ScrollView contentContainerStyle={styles.content} testID="moderation-notice">
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>{t(isWarning ? 'moderation.warningTitle' : 'moderation.resultTitle')}</Text>
          <Text style={styles.body}>{t(isWarning ? 'moderation.warningIntro' : 'moderation.resultMessage')}</Text>
          {isWarning && notice.reason ? (
            <View style={styles.section}>
              <Text style={styles.label}>{t('moderation.reasonLabel')}</Text>
              <Text style={styles.body} testID="moderation-notice-reason">{notice.reason}</Text>
            </View>
          ) : null}
          {isWarning && notice.guidance ? (
            <View style={styles.section}>
              <Text style={styles.label}>{t('moderation.guidanceLabel')}</Text>
              <Text style={styles.body} testID="moderation-notice-guidance">{notice.guidance}</Text>
            </View>
          ) : null}
        </View>
        {saveFailed ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t('moderation.acknowledgeFailed')}</Text> : null}
        {isAcknowledged ? (
          <Text style={styles.acknowledged} testID="moderation-notice-acknowledged">{t('moderation.acknowledged')}</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving, busy: isSaving }}
            disabled={isSaving}
            onPress={() => { acknowledge().catch(() => undefined); }}
            style={styles.primaryButton}
            testID="moderation-notice-acknowledge"
          >
            {isSaving ? <ActivityIndicator color={colors.onBrand} size="small" /> : <Text style={styles.primaryLabel}>{t('moderation.acknowledge')}</Text>}
          </Pressable>
        )}
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  loading: { marginTop: spacing.xl },
  content: { gap: spacing.lg, padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  section: { gap: spacing.xs },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  error: { color: colors.dangerText, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  acknowledged: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.onBrand, fontSize: 15, fontWeight: '700', textAlign: 'center' },
}));

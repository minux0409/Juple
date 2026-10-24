import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import {
  getPushPermissionStatus,
  requestPushPermission,
  type PushPermissionStatus,
} from '../push/pushPermission';
import {
  hasRequestedPushPermission,
  markPushPermissionRequested,
} from '../push/pushPermissionRequestState';
import { syncPushRegistration } from '../push/pushRegistrationSync';
import {
  getPushSyncReport,
  subscribePushSync,
} from '../push/pushRegistrationStatus';
import {
  colors,
  radii,
  spacing,
  minTouchTarget,
  themedStyles,
} from '../theme/tokens';

export function PermissionsScreen() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const [permission, setPermission] =
    useState<PushPermissionStatus>('unavailable');
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(getPushSyncReport);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const [actual, decided] = await Promise.all([
      getPushPermissionStatus(),
      hasRequestedPushPermission().catch(() => false),
    ]);
    if (mounted.current) {
      setPermission(actual);
      setAsked(decided);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh().catch(() => undefined);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh().catch(() => undefined);
    });
    const unsubscribe = subscribePushSync(setReport);
    return () => {
      mounted.current = false;
      subscription.remove();
      unsubscribe();
    };
  }, [refresh]);
  const allow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markPushPermissionRequested().catch(() => undefined);
      const actual = await requestPushPermission();
      if (mounted.current) {
        setPermission(actual);
        setAsked(true);
      }
      if (actual === 'granted')
        await syncPushRegistration(request, () => mounted.current);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const openSettings = () => {
    Linking.openSettings().catch(() => {
      refresh().catch(() => undefined);
    });
  };
  const canAsk =
    Platform.OS === 'ios'
      ? permission === 'notDetermined'
      : Number(Platform.Version) >= 33 && permission !== 'granted' && !asked;
  return (
    <StackScreenSafeArea style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('permissions.title')}
        </Text>
        <Text style={styles.body}>{t('permissions.intro')}</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>{t('permissions.notifications')}</Text>
          <Text style={styles.body}>{t('permissions.reason')}</Text>
          <Text testID="notification-os-status" style={styles.body}>
            {t(`permissions.${permission}`)}
          </Text>
          {canAsk ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                allow().catch(() => undefined);
              }}
              style={styles.button}
              testID="permission-allow"
            >
              <Text style={styles.action}>{t('permissions.allow')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={openSettings}
            style={styles.button}
          >
            <Text style={styles.action}>{t('permissions.settings')}</Text>
          </Pressable>
          {permission === 'granted' ? (
            <>
              <Text style={styles.body} testID="push-registration-status">
                {t(`permissions.sync.${report.status}`)}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  syncPushRegistration(request, () => mounted.current).catch(
                    () => undefined,
                  );
                }}
                style={styles.button}
                testID="push-registration-retry"
              >
                <Text style={styles.action}>{t('permissions.retry')}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>{t('permissions.photos')}</Text>
          <Text style={styles.body}>{t('permissions.picker')}</Text>
        </View>
      </ScrollView>
    </StackScreenSafeArea>
  );
}
const styles = themedStyles(() => ({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.xl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    gap: spacing.lg,
  },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  heading: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    flexShrink: 1,
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  button: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    padding: spacing.md,
    alignSelf: 'stretch',
  },
  action: {
    color: colors.brand,
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },
}));

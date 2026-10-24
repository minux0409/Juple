import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text, View } from 'react-native';
import { webAppUrl } from '../config/webAppUrl';
import { LaptopIcon } from '../icons/LaptopIcon';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { useAppToast } from './AppToast';

/**
 * 내 페이지's small "Juple on the PC" banner: a plain external link to the Web app's address. Nothing about the session is sent -
 * the Web signs in on its own (webAppUrl is a bare https origin).
 */
export function WebAppBanner() {
  const { t } = useTranslation();
  const { showNotificationToast } = useAppToast();
  const open = async () => {
    // No Linking.canOpenURL pre-check (Android package visibility) - the same rule as opening a saved link.
    try {
      await Linking.openURL(webAppUrl);
    } catch {
      showNotificationToast(t('item.urlOpenFailed'));
    }
  };
  return (
    <View style={styles.banner} testID="my-web-banner">
      <View style={styles.icon}>
        <LaptopIcon color={colors.brand} size={22} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('myPage.webBannerTitle')}</Text>
        <Text style={styles.body}>{t('myPage.webBannerBody')}</Text>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={open} style={styles.action} testID="my-web-banner-open">
          <Text style={styles.actionLabel}>{t('myPage.webBannerAction')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    ...cardShadow,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  action: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  actionLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
}));

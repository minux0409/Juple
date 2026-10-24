import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { LaptopIcon } from '../icons/LaptopIcon';
import { cardShadow, colors, radii, spacing, themedStyles } from '../theme/tokens';

/** Informational Web promotion; no navigation or session transfer. */
export function WebAppBanner() {
  const { t } = useTranslation();
  return (
    <View style={styles.banner} testID="my-web-banner">
      <View style={styles.icon}>
        <LaptopIcon color={colors.brand} size={22} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('myPage.webBannerTitle')}</Text>
        <Text style={styles.body}>{t('myPage.webBannerBody')}</Text>
        <Text style={styles.domain}>juple.co.kr</Text>
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
  domain: { color: colors.brand, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
}));

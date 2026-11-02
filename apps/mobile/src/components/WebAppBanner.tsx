import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Text, View, useWindowDimensions } from 'react-native';
import { JupleBrandMark } from './JupleBrandMark';
import { Pressable } from './Pressable';
import { useMessageDialog } from './useMessageDialog';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';

const OFFICIAL_WEB_URL = 'https://juple.co.kr';
const OPEN_DEBOUNCE_MS = 1000;

/** The official homepage is outside our /c/* Universal Links and /open-app Android App Link. */
export function WebAppBanner() {
  const { t } = useTranslation();
  const { showMessage, messageDialog } = useMessageDialog();
  const opening = useRef(false);
  const lastOpenedAt = useRef<number | null>(null);
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.2;
  const openWeb = async () => {
    const now = Date.now();
    if (opening.current || (lastOpenedAt.current !== null && now - lastOpenedAt.current < OPEN_DEBOUNCE_MS)) {
      return;
    }
    opening.current = true;
    lastOpenedAt.current = now;
    try {
      // No canOpenURL probe: Android package visibility may reject a browser that openURL can use.
      await Linking.openURL(OFFICIAL_WEB_URL);
    } catch {
      lastOpenedAt.current = null;
      showMessage(t('customerCenter.openLinkFailed'));
    } finally {
      opening.current = false;
    }
  };
  return (
    <>
      <Pressable accessibilityLabel={`${t('item.goToUrlA11y')}: Juple (juple.co.kr)`} accessibilityRole="button" onPress={openWeb} style={styles.banner} testID="my-web-banner">
        <View pointerEvents="none" style={styles.halo} />
        <View style={styles.text}>
          <Text style={styles.title}>{t('myPage.webBannerTitle')}</Text>
          <Text style={styles.body}>{t('myPage.webBannerBody')}</Text>
          <Text style={styles.domain}>juple.co.kr</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.browser, compact && styles.browserCompact]} testID="web-banner-browser">
          <View style={styles.browserBar}><View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} /></View>
          <View style={styles.browserBody}>
            <JupleBrandMark size="small" style={compact ? styles.logoCompact : styles.logo} testID="web-banner-official-logo" />
            <View style={styles.browserLine} /><View style={[styles.browserLine, styles.shortLine]} />
          </View>
        </View>
      </Pressable>
      {messageDialog}
    </>
  );
}
const styles = themedStyles(() => ({
  banner: { alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: radii.lg,
    flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, overflow: 'hidden', padding: spacing.lg },
  halo: { position: 'absolute', right: -48, top: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: colors.surface, opacity: 0.35 },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  domain: { color: colors.brandText, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  browser: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: radii.md,
    flexShrink: 0, overflow: 'hidden', width: 112, transform: [{ rotate: '5deg' }] },
  browserCompact: { width: 76 },
  browserBar: { backgroundColor: colors.surfaceMuted, flexDirection: 'row', gap: 3, padding: 7 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.border },
  browserBody: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.lg },
  logo: { width: 84, height: 28 },
  logoCompact: { width: 54, height: 18 },
  browserLine: { width: '90%', height: 5, borderRadius: 3, backgroundColor: colors.brandSoft },
  shortLine: { width: '65%' },
}));

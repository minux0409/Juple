import { useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { AppNativeModal as Modal } from '../components/AppNativeModal';
import { DialogActions, type DialogAction } from '../components/DialogActions';
import { Pressable } from '../components/Pressable';
import { useReduceMotion } from '../components/useReduceMotion';
import { HeartIcon } from '../icons/HeartIcon';
import { BRAND_PRIMARY, colors, radii, spacing, themedStyles } from '../theme/tokens';

/** Juple's pink -> violet -> blue (the app icon's sweep), for the badge at the top of the membership popups. */
export const MEMBERSHIP_GRADIENT = ['#F2389A', BRAND_PRIMARY, '#3FA9F5'] as const;

interface MembershipPromptDialogProps {
  readonly visible: boolean;
  readonly icon: 'gift' | 'heart';
  readonly title: string;
  readonly body: string;
  readonly primaryLabel: string;
  readonly onPrimary: () => void;
  readonly secondaryLabel?: string;
  readonly onSecondary?: () => void;
  /** Android back and a tap outside the card. Only ever a plain close - never a purchase, a cancellation or a data change. */
  readonly onRequestClose: () => void;
  readonly testID: string;
}

/**
 * The shape of the two membership popups (the new-account welcome and the free-period-ended notice): a gradient badge, a title, words that
 * scroll inside the card when a long translation or a large accessibility font needs it, and the shared DialogActions. The card stays inside
 * the real safe-area insets (never under the status bar, the notch or the home indicator) and above everything else on screen, so it cannot
 * collide with the tab bar. It fades and rises in gently; with Reduce Motion it simply appears.
 */
export function MembershipPromptDialog({ visible, icon, title, body, primaryLabel, onPrimary, secondaryLabel, onSecondary, onRequestClose, testID }: MembershipPromptDialogProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      appear.setValue(0);
      return;
    }
    if (reduceMotion) {
      appear.setValue(1);
      return;
    }
    Animated.timing(appear, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [appear, reduceMotion, visible]);

  const actions: DialogAction[] = [
    ...(secondaryLabel && onSecondary ? [{ label: secondaryLabel, onPress: onSecondary, tone: 'secondary' as const, testID: `${testID}-secondary` }] : []),
    { label: primaryLabel, onPress: onPrimary, tone: 'brand' as const, testID: `${testID}-primary` },
  ];

  return (
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={onRequestClose} statusBarTranslucent transparent visible={visible}>
      <View
        style={[
          styles.overlay,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg, paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg },
        ]}
      >
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onRequestClose}
          style={StyleSheet.absoluteFill}
          testID={`${testID}-backdrop`}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              opacity: appear,
              transform: [
                { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
            },
          ]}
          testID={testID}
        >
          <ScrollView bounces={false} contentContainerStyle={styles.scrollContent} style={styles.scroll}>
            <GradientBadge icon={icon} />
            <Text lineBreakStrategyIOS="hangul-word" accessibilityRole="header" style={styles.title} testID={`${testID}-title`}>{title}</Text>
            <Text lineBreakStrategyIOS="hangul-word" style={styles.body} testID={`${testID}-body`}>{body}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <DialogActions actions={actions} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function GradientBadge({ icon }: { readonly icon: 'gift' | 'heart' }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.badge}>
      <Svg height="100%" style={StyleSheet.absoluteFill} viewBox="0 0 64 64" width="100%">
        <Defs>
          <LinearGradient id="membershipBadge" x1="0" x2="1" y1="0" y2="1">
            <Stop offset="0" stopColor={MEMBERSHIP_GRADIENT[0]} />
            <Stop offset="0.55" stopColor={MEMBERSHIP_GRADIENT[1]} />
            <Stop offset="1" stopColor={MEMBERSHIP_GRADIENT[2]} />
          </LinearGradient>
        </Defs>
        <Rect fill="url(#membershipBadge)" height="64" rx="32" width="64" />
      </Svg>
      {icon === 'gift' ? <GiftGlyph /> : <HeartIcon color="#FFFFFF" filled size={30} />}
    </View>
  );
}

/** A gift box with two small sparkles, drawn in white for the gradient badge. */
function GiftGlyph() {
  return (
    <Svg fill="none" height={34} viewBox="0 0 34 34" width={34}>
      <Path d="M6 15h22v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V15Z" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={2} />
      <Path d="M4.5 10.5h25v4.5h-25z" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={2} />
      <Path d="M17 10.5V29" stroke="#FFFFFF" strokeWidth={2} />
      <Path d="M17 10.5c-1.5-3.8-6.8-5-6.8-1.6 0 1.4 1.6 1.6 6.8 1.6Zm0 0c1.5-3.8 6.8-5 6.8-1.6 0 1.4-1.6 1.6-6.8 1.6Z" stroke="#FFFFFF" strokeLinejoin="round" strokeWidth={2} />
      <Path d="M28 2.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill="#FFFFFF" />
      <Path d="M5 3.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" fill="#FFFFFF" />
    </Svg>
  );
}

const styles = themedStyles(() => ({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.45)', flex: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    flexShrink: 1,
    // A dialog on a phone, capped on a tablet or an unfolded foldable.
    maxWidth: 400,
    overflow: 'hidden',
    paddingBottom: spacing.xl,
    width: '100%',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  badge: { alignItems: 'center', height: 64, justifyContent: 'center', marginBottom: spacing.lg, width: 64 },
  title: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', lineHeight: 26, textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: spacing.md, textAlign: 'center' },
  actions: { marginTop: spacing.xl, paddingHorizontal: spacing.xl },
}));

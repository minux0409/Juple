import { useContext, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { BottomTabBarHeightCallbackContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppNativeModal as Modal } from '../components/AppNativeModal';
import { Pressable } from '../components/Pressable';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
import { useReduceMotion } from '../components/useReduceMotion';
import { MoreIcon } from '../icons/MoreIcon';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { useSelectionBarModel, type SelectionBarAction, type SelectionBarModel, type SelectionMenuRow } from './SelectionBarContext';

/** The narrowest a button may get: a 44pt touch target plus room for a short label. */
export const SELECTION_BAR_SLOT_MIN_WIDTH = 72;
const BAR_CONTENT_HEIGHT = 56;
const ICON_SIZE = 22;
const ANIMATION_IN_MS = 180;
const ANIMATION_OUT_MS = 130;
const ENTER_OFFSET = 18;

/**
 * Splits the bar's buttons into those that fit on one line and the rest. When something does not fit, the last visible slot becomes
 * 더보기 and the overflow joins its menu - a narrow phone, a split-screen window or a long translation never squeezes or clips a
 * button. Order is kept; an existing 더보기 button (`menu`) is the one that absorbs the overflow.
 */
export function splitBarActions(
  actions: readonly SelectionBarAction[],
  width: number,
  moreLabel: string,
): { readonly visible: readonly SelectionBarAction[]; readonly menu: readonly SelectionMenuRow[] | null } {
  const slots = Math.max(2, Math.floor(width / SELECTION_BAR_SLOT_MIN_WIDTH));
  const existingMore = actions.find(action => action.menu !== undefined);
  const plain = actions.filter(action => action !== existingMore);
  const total = plain.length + (existingMore ? 1 : 0);
  if (total <= slots) {
    return { visible: actions, menu: null };
  }
  // Keep (slots - 1) buttons and let 더보기 take the rest.
  const keep = plain.slice(0, slots - 1);
  const spilled = plain.slice(slots - 1);
  const rows: SelectionMenuRow[] = [
    ...spilled.map(action => ({
      key: action.key,
      label: action.label,
      icon: action.icon,
      destructive: action.destructive,
      disabled: action.disabled,
      onPress: () => action.onPress?.(),
    })),
    ...(existingMore?.menu ?? []),
  ];
  const more: SelectionBarAction = { key: 'more', label: moreLabel, icon: MoreIcon, menu: rows, busy: existingMore?.busy };
  return { visible: [...keep, more], menu: rows };
}

/**
 * The floating action bar of selection mode: an independent rounded surface with its own shadow, inset from the screen's sides and
 * lifted above the system navigation bar / iOS home indicator (the inset is added once), so it reads as a mode and never as the tab
 * bar. It sits in the tab bar's slot (MainTabs), so the list above simply ends where the slot begins - the last link is never behind it -
 * and the slot reports its height to the screens (toasts follow it). It slides and fades in and out briefly (not with reduced motion).
 */
export function SelectionActionBar({ model, leaving = false, onLeft }: { readonly model: SelectionBarModel; readonly leaving?: boolean; readonly onLeft?: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const [slotHeight, setSlotHeight] = useState(0);
  const [openMenu, setOpenMenu] = useState<readonly SelectionMenuRow[] | null>(null);
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(leaving ? 0 : 1);
      if (leaving) {
        onLeftRef.current?.();
      }
      return undefined;
    }
    const animation = Animated.timing(progress, { toValue: leaving ? 0 : 1, duration: leaving ? ANIMATION_OUT_MS : ANIMATION_IN_MS, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished && leaving) {
        onLeftRef.current?.();
      }
    });
    return () => animation.stop();
  }, [leaving, progress, reduceMotion]);

  useEffect(() => {
    if (leaving) {
      setOpenMenu(null);
    }
  }, [leaving]);

  const isBusy = model.actions.some(action => action.busy === true);
  const { visible } = width > 0 ? splitBarActions(model.actions, width, t('selection.more')) : { visible: model.actions };

  const handleLayout = (event: LayoutChangeEvent) => {
    setSlotHeight(event.nativeEvent.layout.height);
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View onLayout={handleLayout} pointerEvents={leaving ? 'none' : 'auto'} style={[styles.slot, { paddingBottom: insets.bottom + spacing.sm }]} testID="selection-action-bar">
      <Animated.View
        accessibilityRole="toolbar"
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.card, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [ENTER_OFFSET, 0] }) }] }]}
        testID="selection-action-card"
      >
        {visible.map(action => {
          const color = action.disabled ? colors.textMuted : action.destructive ? colors.destructiveText : colors.textPrimary;
          const Icon = action.icon;
          return (
            <Pressable
              accessibilityLabel={action.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: action.disabled === true || isBusy, busy: action.busy === true }}
              disabled={action.disabled === true || isBusy}
              key={action.key}
              onPress={() => {
                if (action.menu) {
                  setOpenMenu(action.menu);
                } else {
                  action.onPress?.();
                }
              }}
              style={styles.button}
              testID={`selection-action-${action.key}`}
            >
              <Icon color={color} size={ICON_SIZE} />
              <Text numberOfLines={2} style={[styles.label, { color }]}>{action.label}</Text>
            </Pressable>
          );
        })}
      </Animated.View>
      <Modal animationType="fade" onDismiss={onMenuDismiss} onRequestClose={() => setOpenMenu(null)} transparent visible={openMenu !== null}>
        <View style={styles.overlay}>
          {/* The backdrop only closes the menu - a touch outside never runs an action. */}
          <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={() => setOpenMenu(null)} style={StyleSheet.absoluteFill} testID="selection-more-backdrop" />
          {/* Anchored above the floating bar (its measured height), at the end side where 더보기 is. */}
          <View accessibilityViewIsModal style={[styles.menu, { marginBottom: slotHeight + spacing.xs }]} testID="selection-more-menu">
            {(openMenu ?? []).map(row => {
              const color = row.disabled ? colors.textMuted : row.destructive ? colors.destructiveText : colors.textPrimary;
              const Icon = row.icon;
              return (
                <Pressable
                  accessibilityLabel={row.label}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: row.disabled === true }}
                  disabled={row.disabled}
                  key={row.key}
                  onPress={() => afterMenuCloses(() => setOpenMenu(null), row.onPress)}
                  style={styles.menuRow}
                  testID={`selection-more-${row.key}`}
                >
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.menuIcon}>{Icon ? <Icon color={color} size={20} /> : null}</View>
                  <Text numberOfLines={2} style={[styles.menuLabel, { color }]}>{row.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * What MainTabs puts in the tab bar's slot: the ordinary tab bar (`fallback`), or - while a screen publishes a selection bar - that bar.
 * When selection ends the bar animates out before the tab bar returns; the tab bar itself is never altered.
 */
export function SelectionBarSlot({ fallback }: { readonly fallback: ReactElement }) {
  const model = useSelectionBarModel();
  const [last, setLast] = useState<SelectionBarModel | null>(model);
  useEffect(() => {
    if (model !== null) {
      setLast(model);
    }
  }, [model]);
  const shown = model ?? last;
  if (shown === null) {
    return fallback;
  }
  return <SelectionActionBar leaving={model === null} model={shown} onLeft={() => setLast(null)} />;
}

const styles = themedStyles(() => ({
  // The slot is transparent over the page's own background; the bar floats inside it with room on every side.
  slot: { backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 10,
    flexDirection: 'row',
    minHeight: BAR_CONTENT_HEIGHT,
    paddingHorizontal: spacing.xs,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  button: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: Math.max(BAR_CONTENT_HEIGHT, minTouchTarget),
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  overlay: { alignItems: 'flex-end', flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.md },
  menu: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    elevation: 12,
    maxWidth: 320,
    minWidth: 200,
    overflow: 'hidden',
    paddingVertical: spacing.xs,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  menuRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget + 4, paddingHorizontal: spacing.lg },
  menuIcon: { alignItems: 'center', width: 24 },
  menuLabel: { flexShrink: 1, fontSize: 15 },
}));

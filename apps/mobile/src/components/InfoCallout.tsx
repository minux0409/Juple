import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { InfoIcon } from '../icons/InfoIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

const GLYPH_SIZE = 16;
const SIDE_MARGIN = spacing.lg;
const FALLBACK_TOP = 160;

interface Measurable {
  readonly measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

/**
 * A small info button with its explanation in a light callout beneath it - no dim overlay and no actions: tap the
 * button again, tap anywhere outside, or press back to dismiss. The glyph is small and muted, the touch target is
 * a full 44dp. The callout is as wide as the window minus its side margins (so it never clips at 320dp and needs no
 * left/right mirroring) and its text follows the reading direction.
 */
export function InfoCallout({ accessibilityLabel, message, testID }: {
  readonly accessibilityLabel: string;
  readonly message: string;
  readonly testID?: string;
}) {
  const { width } = useWindowDimensions();
  const anchorRef = useRef<Measurable | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [top, setTop] = useState(FALLBACK_TOP);

  const open = () => {
    // Opens at once; the position follows the measured anchor (a fallback below the header until then).
    setIsOpen(true);
    const anchor = anchorRef.current;
    if (anchor && typeof anchor.measureInWindow === 'function') {
      anchor.measureInWindow((_x, y, _w, height) => setTop(y + height + spacing.xs));
    }
  };
  const close = () => setIsOpen(false);

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        collapsable={false}
        hitSlop={0}
        onPress={isOpen ? close : open}
        ref={anchorRef as never}
        style={styles.button}
        testID={testID}
      >
        <InfoIcon color={colors.textSecondary} size={GLYPH_SIZE} />
      </Pressable>
      <Modal animationType="fade" onRequestClose={close} statusBarTranslucent transparent visible={isOpen}>
        {/* Outside taps dismiss (the backdrop is invisible, not dimmed). */}
        <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" onPress={close} style={StyleSheet.absoluteFill} testID={testID ? `${testID}-dismiss` : undefined}>
          <View accessibilityLiveRegion="polite" style={[styles.callout, { top, width: Math.max(0, width - SIDE_MARGIN * 2) }]} testID={testID ? `${testID}-message` : undefined}>
            <Text style={styles.message}>{message}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // A full 44dp target around a 16dp glyph; the negative margins keep the host row as compact as without it.
  button: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', marginVertical: -10, width: minTouchTarget },
  callout: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    elevation: 4,
    padding: spacing.md,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  message: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
});

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../theme/tokens';

/** How long the backdrop fade / sheet slide takes - an animation duration, not a wait before showing anything. */
const ENTRANCE_MS = 200;

interface BottomSheetModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Rendered inside the same native Modal after the sheet (e.g. a ConfirmDialog opened from it), so iOS never stacks two Modals. */
  readonly modalExtras?: ReactNode;
  readonly testID: string;
}

/**
 * Juple's bottom sheet (the participants popup, the 승인 대기 popups): content-driven height capped at
 * 75% of the screen, rounded top corners, dim backdrop, scrolling is the content's own job. ONE
 * controlled entrance driven by a single value (0 = not shown, 1 = shown): the dim backdrop fades in
 * and the sheet slides up from just below its own final position - and until the sheet has been laid
 * out once (its real height known) it is fully transparent, so no first frame ever shows an
 * unanimated white panel, a default-sized one, or one that is still resizing. The animation starts
 * from that first layout, not from a timer, and never again while the sheet stays open (the content
 * growing later changes nothing about it). The native Modal does not animate ("none") so the two
 * never stack; the whole window is translucent like every other modal here.
 */
export function BottomSheetModal({ visible, onClose, children, modalExtras, testID }: BottomSheetModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const entrance = useRef(new Animated.Value(0)).current;
  const entranceStartedRef = useRef(false);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) {
      entrance.setValue(0);
      entranceStartedRef.current = false;
      setSheetHeight(null);
    }
  }, [entrance, visible]);

  const handleSheetLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0 && !entranceStartedRef.current) {
      entranceStartedRef.current = true;
      setSheetHeight(height);
      Animated.timing(entrance, { duration: ENTRANCE_MS, toValue: 1, useNativeDriver: true }).start();
    }
  };

  return (
    <Modal animationType="none" navigationBarTranslucent onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.overlay}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: entrance }]} testID={`${testID}-backdrop`} />
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            { paddingBottom: spacing.lg + insets.bottom },
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight ?? windowHeight, 0] }) }] },
          ]}
          testID={testID}
        >
          {children}
        </Animated.View>
      </View>
      {modalExtras}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '75%',
    maxWidth: 640,
    padding: spacing.lg,
    width: '100%',
  },
});

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface StackScreenSafeAreaProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Juple's screen layout invariant: no interactive content may render behind Android's system
 * navigation bar. The root container every stack screen with a native header (back button + title
 * - i.e. one with no Juple tab bar below it to already reserve that inset, unlike MainTabs' own tab
 * screens - see those screens' own `edges={['top']}` SafeAreaView) should render as its outermost
 * element.
 *
 * `edges={['bottom']}` only (never 'top', which the native header already handles) makes
 * react-native-safe-area-context apply the real bottom inset as actual View padding on this
 * container - not just scrollable content padding. Folding insets.bottom into only a
 * FlatList/ScrollView's `contentContainerStyle` (or even the list's own `style`) is not enough on a
 * real device: it only reserves *scroll* space, which a short screen or a scroll position short of
 * the very end never actually pushes past the real bottom edge - it does not shrink the rendered
 * viewport itself, so content can still be laid out behind the translucent system nav bar. Giving
 * THIS container real padding instead physically shrinks every child's available height, so a
 * flex:1 FlatList/ScrollView inside it can never render a pixel under the system nav bar, regardless
 * of scroll position or content length. The padding band itself is filled by this same container's
 * own `style` background (pass an opaque one, e.g. colors.background), so it reads as a solid,
 * fully separate area rather than translucent app content showing through the system bar.
 */
export function StackScreenSafeArea({ children, style }: StackScreenSafeAreaProps) {
  return (
    <SafeAreaView edges={['bottom']} style={style}>
      {children}
    </SafeAreaView>
  );
}

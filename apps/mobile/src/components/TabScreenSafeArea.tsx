import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface TabScreenSafeAreaProps extends Pick<ViewProps, 'onTouchStart' | 'testID'> {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The root container of a bottom-tab screen (Home, 보관함, 컬렉션, 내 페이지): keeps the content below the status bar / notch.
 *
 * The top inset comes from the SafeAreaProvider's context (`useSafeAreaInsets`), which already holds the measured window insets
 * when the screen first renders - so the very first frame is laid out at the final position. The native `SafeAreaView` used before
 * measured its own inset only once its view was attached to the window and then applied it a frame later: every tab mounts lazily
 * on its first visit, so after each cold start every tab's header first appeared one status-bar height too high and then dropped
 * into place (once per tab). Only the top edge: the tab bar below already reserves the bottom inset, and the stack screens use
 * StackScreenSafeArea.
 *
 * A paddingTop in `style` is kept and the inset added to it (the same as SafeAreaView's padding mode).
 */
export function TabScreenSafeArea({ children, style, onTouchStart, testID }: TabScreenSafeAreaProps) {
  const { top } = useSafeAreaInsets();
  const ownPaddingTop = StyleSheet.flatten(style)?.paddingTop;
  const paddingTop = top + (typeof ownPaddingTop === 'number' ? ownPaddingTop : 0);
  return (
    <View onTouchStart={onTouchStart} style={[style, { paddingTop }]} testID={testID}>
      {children}
    </View>
  );
}

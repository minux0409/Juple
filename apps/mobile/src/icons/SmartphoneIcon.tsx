import { StyleSheet, View } from 'react-native';

interface SmartphoneIconProps {
  readonly size?: number;
}

/**
 * Simple rounded smartphone silhouette (white body, black outline, small home-indicator line) -
 * Juple's shared "device" glyph. Used by the "use system language" option (replacing a globe emoji
 * - see LanguageBadge.tsx/LanguageSettingsScreen.tsx). Built from plain Views rather than an emoji
 * or a new icon-font/SVG dependency (none exists in this app), so it renders identically across
 * Android/iOS/OS versions and font revisions.
 */
export function SmartphoneIcon({ size = 16 }: SmartphoneIconProps) {
  const width = size;
  const height = size * 1.4;
  const borderRadius = size * 0.22;
  const borderWidth = Math.max(1, size * 0.09);

  return (
    <View style={[styles.body, { width, height, borderRadius, borderWidth }]}>
      <View
        style={[
          styles.homeIndicator,
          { width: size * 0.4, height: size * 0.09, borderRadius: size * 0.05 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#111111',
    justifyContent: 'flex-end',
    paddingBottom: '10%',
  },
  homeIndicator: {
    backgroundColor: '#111111',
  },
});

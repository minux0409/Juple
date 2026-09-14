import { StyleSheet, Text, View } from 'react-native';
import { SmartphoneIcon } from './SmartphoneIcon';

export type LanguageBadgeContent =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'device' };

interface LanguageBadgeProps {
  readonly content: LanguageBadgeContent;
}

const BADGE_SIZE = 28;

/**
 * One consistent badge shape (same height/outline/radius) for every language option in
 * LanguageSettingsScreen - either a short language code ("KO", "EN", "ZH-S", ...) or, for "use
 * system language", the same device glyph as SmartphoneIcon (a system-language preference
 * literally means "whatever the device is set to", so a device icon is the meaning, not just a
 * stand-in for a missing flag). Replaces the previous mix of a national flag emoji (Korean) and a
 * globe emoji (English/System) - flag emoji render inconsistently across platforms/OS versions and
 * tie a language to a country it does not represent (`en` is Juple's generic English, not US
 * English). Adding another locale is just one more `{ kind: 'code', code: '...' }` entry - no new
 * badge variant needed. Width is a minWidth (not fixed), since the 17 supported languages' codes
 * range from two characters ("KO") to four ("ZH-S") - a fixed square would clip the longer ones.
 */
export function LanguageBadge({ content }: LanguageBadgeProps) {
  return (
    <View style={styles.badge}>
      {content.kind === 'code' ? (
        <Text style={styles.code}>{content.code}</Text>
      ) : (
        <SmartphoneIcon size={14} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    height: BADGE_SIZE,
    justifyContent: 'center',
    minWidth: BADGE_SIZE,
    paddingHorizontal: 4,
  },
  code: {
    color: '#111111',
    fontSize: 11,
    fontWeight: '700',
  },
});

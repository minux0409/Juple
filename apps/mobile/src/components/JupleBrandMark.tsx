import { Image, type ImageStyle, type StyleProp } from 'react-native';

/**
 * The Juple brand lockup - the SAME artwork as the Web (app icon + the gradient "Juple" wordmark; regenerated from the Web's own
 * brand spec by scripts/generate-brand-assets.py). The only place standalone brand identity is drawn in the app: never rebuild it
 * from Text, and never use it for the product name inside a sentence (that stays plain text). Transparent background.
 *   lockup   icon + wordmark (sign-in, Agreement, Home header, startup, About)
 *   wordmark the gradient "Juple" alone
 */
const LOCKUP = require('../../assets/branding/juple-lockup.png');
const WORDMARK = require('../../assets/branding/juple-wordmark.png');

const LOCKUP_ASPECT = 769 / 256;
const WORDMARK_ASPECT = 417 / 155;

/** Heights in dp; the width follows the artwork's own proportions. */
const HEIGHTS = { small: 28, medium: 48, large: 72 } as const;

export type JupleBrandMarkSize = keyof typeof HEIGHTS;

interface JupleBrandMarkProps {
  readonly variant?: 'lockup' | 'wordmark';
  readonly size?: JupleBrandMarkSize;
  readonly style?: StyleProp<ImageStyle>;
  readonly testID?: string;
}

export function JupleBrandMark({ variant = 'lockup', size = 'medium', style, testID = 'juple-brand-mark' }: JupleBrandMarkProps) {
  const height = HEIGHTS[size];
  const aspect = variant === 'lockup' ? LOCKUP_ASPECT : WORDMARK_ASPECT;
  return (
    <Image
      accessibilityLabel="Juple"
      accessibilityRole="image"
      accessible
      resizeMode="contain"
      source={variant === 'lockup' ? LOCKUP : WORDMARK}
      style={[{ height, width: Math.round(height * aspect) }, style]}
      testID={testID}
    />
  );
}

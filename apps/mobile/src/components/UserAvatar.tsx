import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { UserIcon } from '../icons/UserIcon';
import { replaceFailedProfileImageUri, resolveProfileImageUri } from '../profile/profileImageCache';
import { colors } from '../theme/tokens';

interface UserAvatarProps {
  /** The person's public Juple ID - the cache identity together with imageVersion (never an internal id). */
  readonly jupleId: string;
  /** Their nickname, for the fallback initial; null/empty falls back to a generic person glyph. */
  readonly displayName?: string | null;
  /** Short-lived signed URL (or a just-picked local file in the Profile editor's preview). */
  readonly imageUrl?: string | null;
  /** The server's profileImageVersion - keeps one URI per photo across responses (see profileImageCache). */
  readonly imageVersion?: string | null;
  /** Diameter in dp (24, 32, 40, 56, 72 are the sizes in use). */
  readonly size?: number;
}

/**
 * The first character (code point - so an emoji or a Hangul syllable is never split in half) of a
 * nickname, uppercased for scripts that have case. The server stores nicknames NFC-normalized, so
 * an accented letter is already one code point. Deliberately no Intl.Segmenter: Hermes does not
 * guarantee it, and a ZWJ emoji showing only its first person is fine for a 1-character badge.
 * Null when there is nothing to show.
 */
export function avatarInitial(displayName: string | null | undefined): string | null {
  const first = Array.from(displayName?.trim() ?? '')[0];
  return first ? first.toLocaleUpperCase() : null;
}

/**
 * A person's circular avatar: their photo when they have one (cover-cropped to the circle), else
 * the first character of their nickname, else a person glyph. A photo that fails to load (an
 * expired link after the cached copy was evicted) falls back to the response's fresh URL, then to
 * the initial - never an empty circle. Decorative for assistive technology: the name next to it
 * already says who it is.
 */
export function UserAvatar({ jupleId, displayName, imageUrl, imageVersion, size = 40 }: UserAvatarProps) {
  const [failedUris, setFailedUris] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setFailedUris(new Set());
  }, [imageUrl]);

  const keptUri = resolveProfileImageUri(jupleId, imageVersion, imageUrl);
  const displayUri = [keptUri, imageUrl].find(uri => !!uri && !failedUris.has(uri)) ?? null;
  const initial = avatarInitial(displayName);
  const handleImageError = () => {
    if (!displayUri) {
      return;
    }
    if (imageUrl && displayUri !== imageUrl) {
      replaceFailedProfileImageUri(jupleId, displayUri, imageUrl);
    }
    setFailedUris(previous => new Set(previous).add(displayUri));
  };

  const circle = { borderRadius: size / 2, height: size, width: size };
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, circle]}
      testID={displayUri ? 'user-avatar-image' : 'user-avatar-fallback'}
    >
      {displayUri ? (
        <Image onError={handleImageError} resizeMode="cover" source={{ uri: displayUri }} style={[styles.image, circle]} />
      ) : initial ? (
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
          {initial}
        </Text>
      ) : (
        <UserIcon color={colors.brand} size={Math.round(size * 0.56)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  initial: {
    color: colors.brand,
    fontWeight: '700',
  },
});

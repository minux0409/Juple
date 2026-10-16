import type { ReactNode } from 'react';
import { Image, type ImageProps } from 'react-native';
import { useStableImageUri } from './stableImageUri';

type StableImageProps = Omit<ImageProps, 'source' | 'onError'> & {
  /** The photo's stable image-cache identity (images/stableImageUri.ts), or null for a URL that is already stable. */
  readonly cacheKey: string | null;
  /** This response's (fresh) URL. */
  readonly uri: string | null;
  /** Shown when there is no URL, or neither the kept nor the fresh URL could be loaded. */
  readonly fallback?: ReactNode;
};

/** A plain React Native Image that reuses the kept URI of a photo (cache hit) and falls back once to the fresh URL. */
export function StableImage({ cacheKey, uri, fallback = null, ...imageProps }: StableImageProps) {
  const { uri: shown, onError } = useStableImageUri(cacheKey, uri);
  if (!shown) {
    return <>{fallback}</>;
  }
  return <Image {...imageProps} onError={onError} source={{ uri: shown }} />;
}

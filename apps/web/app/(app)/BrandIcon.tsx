import Image from 'next/image';
import styles from './app.module.css';

/**
 * The real Juple app icon - the same artwork the Android / iOS apps ship (apps/mobile/assets/branding/juple-app-icon-master-1024.png,
 * byte-identical to the iOS AppIcon 1024), resized for the Web. Shown with the rounded-square mask app icons get on a phone;
 * the artwork itself is unchanged.
 */
export function BrandIcon({ size }: { readonly size: number }) {
  return (
    <Image
      alt=""
      aria-hidden
      className={styles.brandIcon}
      height={size}
      priority
      src="/brand/juple-app-icon-256.png"
      style={{ borderRadius: Math.round(size * 0.2237) }}
      width={size}
    />
  );
}

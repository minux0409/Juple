'use client';

import { avatarInitial } from '../../lib/collectionSharing';
import { isSafeHttpUrl } from '../../lib/savedLinks';
import { Glyph } from './Glyph';
import { LinkImage } from './LinkImage';
import styles from './app.module.css';

/** A person's circle (mobile UserAvatar): their photo, else the nickname's first character, else a person glyph - never a made-up face. */
export function Avatar({ person, size }: { readonly person: { readonly displayName?: string | null; readonly profileImageUrl?: string | null }; readonly size: number }) {
  const initial = avatarInitial(person.displayName);
  const fallback = (
    <span aria-hidden className={styles.avatarFallback} style={{ fontSize: Math.round(size * 0.42) }}>
      {initial ?? <Glyph name="User" size={Math.round(size * 0.56)} />}
    </span>
  );
  return (
    <span className={styles.avatar} style={{ width: size, height: size }}>
      <LinkImage fallback={fallback} src={isSafeHttpUrl(person.profileImageUrl) ? (person.profileImageUrl ?? null) : null} />
    </span>
  );
}

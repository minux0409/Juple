'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './app.module.css';

/** The mobile star (apps/mobile/src/icons/StarIcon.tsx, components/FavoriteStar.tsx): the same 24-unit polygon. */
const STAR_POINTS = '12 3 14.6 8.9 21 9.6 16.2 13.9 17.5 20.2 12 17 6.5 20.2 7.8 13.9 3 9.6 9.4 8.9';
const PARTICLES = 8;
/** Mobile PENDING_TTL_MS: a tap whose request never changes the state must not arm a later, unrelated change. */
const PENDING_TTL_MS = 1500;
/** The longest play (ON ~270ms); the burst layer is removed after it. */
const PLAY_MS = 300;

/**
 * The favorite star - the Web counterpart of the mobile FavoriteStar. It only DRAWS the state it is given; the page still owns the toggle,
 * the optimistic flip and its rollback.
 *  - Off: the outline in the icon-stroke colour (mobile colors.border). On: the Juple gradient (coral - pink - violet) fill with a pink outline.
 *  - ON (~270ms): shrinks to 0.85, pops to 1.25 and settles, the gradient fills in and 8 particles (dots and short rays) burst radially.
 *  - OFF (~190ms): 1 - 0.85 - 1 while the gradient shrinks into the centre, leaving the outline. No particles.
 *  - A change that is not preceded by the person's own tap (first paint, a re-read, a rollback, a bulk action) is drawn instantly.
 *  - prefers-reduced-motion: no scale and no particles.
 * Only transform and opacity animate, the particle layer is absolutely positioned and overflows the star without taking any room, so a
 * card's layout never moves.
 */
export function FavoriteStar({ active, size = 20, playToken = 0 }: { readonly active: boolean; readonly size?: number; readonly playToken?: number }) {
  const gradientId = `favoriteStarGradient${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const lastActive = useRef(active);
  const seenToken = useRef(playToken);
  const pending = useRef(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [play, setPlay] = useState<{ readonly kind: 'on' | 'off'; readonly id: number } | null>(null);

  useEffect(
    () => () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      if (playTimer.current) clearTimeout(playTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (playToken !== seenToken.current) {
      seenToken.current = playToken;
      pending.current = true;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        pending.current = false;
      }, PENDING_TTL_MS);
    }
    if (active === lastActive.current) {
      return;
    }
    lastActive.current = active;
    const userTap = pending.current;
    pending.current = false;
    if (playTimer.current) clearTimeout(playTimer.current);
    // State is only set from a timer callback, never synchronously inside the effect.
    const start = setTimeout(() => {
      if (!userTap) {
        // Instant: no animation (first paint, a re-read, a rollback, a bulk action).
        setPlay(null);
        return;
      }
      setPlay(previous => ({ kind: active ? 'on' : 'off', id: (previous?.id ?? 0) + 1 }));
      playTimer.current = setTimeout(() => setPlay(null), PLAY_MS);
    }, 0);
    return () => clearTimeout(start);
  }, [active, playToken]);

  // Particle geometry is based on at least 22px, so the burst of a small star is still clearly visible (mobile).
  const base = Math.max(size, 22);
  const geometry = {
    '--star-size': `${size}px`,
    '--star-dot': `${Math.round(base * 0.2)}px`,
    '--star-ray': `${Math.round(base * 0.38)}px`,
    '--star-ray-width': `${Math.max(2.5, base * 0.1)}px`,
    '--star-inner': `${base * 0.62}px`,
    '--star-outer': `${base * 1.25}px`,
  } as React.CSSProperties;

  return (
    <span aria-hidden className={styles.favStar} data-active={active ? 'true' : 'false'} data-favorite-star data-play={play?.kind} style={geometry}>
      <svg className={styles.favStarSvg} height={size} key={play ? `${play.kind}-${play.id}` : 'still'} viewBox="0 0 24 24" width={size}>
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={gradientId} x1="3" x2="21" y1="20" y2="4">
            <stop className={styles.favStarStop1} offset="0" />
            <stop className={styles.favStarStop2} offset="0.5" />
            <stop className={styles.favStarStop3} offset="1" />
          </linearGradient>
        </defs>
        <polygon className={styles.favStarOutline} points={STAR_POINTS} />
        <polygon className={styles.favStarFill} fill={`url(#${gradientId})`} points={STAR_POINTS} stroke={`url(#${gradientId})`} />
      </svg>
      {play?.kind === 'on' ? (
        <span className={styles.favStarBurst} key={play.id}>
          {Array.from({ length: PARTICLES }, (_, index) => (
            <span
              className={index % 2 === 1 ? styles.favStarRay : styles.favStarDot}
              key={index}
              style={{ '--deg': `${(360 / PARTICLES) * index}deg`, '--tone': `var(--star-grad-${(index % 3) + 1})` } as React.CSSProperties}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** [token, bump]: pass the token to <FavoriteStar playToken>, call bump() from the star button's own click. */
export function useStarTap(): readonly [number, () => void] {
  const [token, setToken] = useState(0);
  const bump = useCallback(() => setToken(value => value + 1), []);
  return [token, bump];
}

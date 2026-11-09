'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The short springy pop of a star that was just turned ON (mobile FavoriteStar burst, restrained for the Web): true for one animation
 * after `isFavorite` goes from false to true while the star is on screen - never on first paint, never when it is turned off.
 * Returned as the value of a `data-pop` attribute (the stylesheet animates `[data-pop='true'] svg`).
 */
export function useFavoritePop(isFavorite: boolean): 'true' | undefined {
  const previous = useRef(isFavorite);
  const [popping, setPopping] = useState(false);
  useEffect(() => {
    const turnedOn = isFavorite && !previous.current;
    previous.current = isFavorite;
    if (!turnedOn) {
      return;
    }
    setPopping(true);
    const timer = setTimeout(() => setPopping(false), 450);
    return () => clearTimeout(timer);
  }, [isFavorite]);
  return popping ? 'true' : undefined;
}

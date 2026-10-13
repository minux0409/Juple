'use client';

import { useEffect, useRef } from 'react';
import { subscribeItemsChanged, type ItemChange } from '../../lib/itemChanges';

/** Runs `onChanged` whenever a link was deleted / removed from a Collection / edited elsewhere (the Quick Detail sheet). */
export function useItemsChanged(onChanged: (change: ItemChange) => void): void {
  const latest = useRef(onChanged);
  useEffect(() => {
    latest.current = onChanged;
  });
  useEffect(() => subscribeItemsChanged(change => latest.current(change)), []);
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isKnownReaction, MAX_RECENT_REACTIONS } from './reactionCatalog';

const STORAGE_KEY = 'juple.recentReactions';

/** Newest first, no duplicates, at most MAX_RECENT_REACTIONS. */
export function pushRecentReaction(recent: readonly string[], key: string): readonly string[] {
  return [key, ...recent.filter(existing => existing !== key)].slice(0, MAX_RECENT_REACTIONS);
}

function parseRecent(raw: string | null): readonly string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const unique = [...new Set(parsed.filter((value): value is string => typeof value === 'string' && isKnownReaction(value)))];
    return unique.slice(0, MAX_RECENT_REACTIONS);
  } catch {
    return [];
  }
}

/**
 * The reactions this device used most recently (a convenience of the picker, kept in this device's
 * own storage - never on the server, and never part of the account). Failures to read or write it
 * are silent: the picker simply has no "최근 사용" then.
 */
export function useRecentReactions() {
  const [recent, setRecent] = useState<readonly string[]>([]);
  const recentRef = useRef<readonly string[]>([]);

  useEffect(() => {
    let isActive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (isActive) {
          recentRef.current = parseRecent(raw);
          setRecent(recentRef.current);
        }
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, []);

  const recordRecent = useCallback((key: string) => {
    recentRef.current = pushRecentReaction(recentRef.current, key);
    setRecent(recentRef.current);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recentRef.current)).catch(() => undefined);
  }, []);

  return { recent, recordRecent } as const;
}

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { hasSeenHint, markHintSeen, type HintId } from './hintPreference';

/** A hint counts as seen once it has stayed visibly mounted this long (or is dismissed / the gesture is performed). */
export const HINT_VISIBLE_THRESHOLD_MS = 1500;

/** Only one hint is ever on screen; an in-memory slot (nothing persisted) keeps two from showing together. */
let activeHint: HintId | null = null;

export interface OneTimeHint {
  readonly isVisible: boolean;
  /** The user closed it: seen immediately. */
  readonly dismiss: () => void;
  /** The user did the thing the hint teaches: seen immediately. */
  readonly markPerformed: () => void;
}

/**
 * Shows a hint at most once per person. `isEligible` must already mean "there is something to do it on" (an
 * empty list never shows one). Until the person's key and stored state are known nothing is shown; an unreadable
 * state counts as seen. Leaving the screen before the threshold clears the timer and records nothing.
 */
export function useOneTimeHint(id: HintId, isEligible: boolean): OneTimeHint {
  const request = useAuthenticatedApi();
  const [isFocused, setIsFocused] = useState(false);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [isSeen, setIsSeen] = useState<boolean | null>(null);
  const [hasSlot, setHasSlot] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // The person's key is only fetched once there is something to show a hint on.
  const needsKey = isEligible && userKey === null;
  useEffect(() => {
    if (!needsKey) {
      return undefined;
    }
    let isMounted = true;
    getMyProfile(request)
      .then(profile => {
        if (isMounted) {
          setUserKey(profile.jupleId);
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, [needsKey, request]);

  useEffect(() => {
    if (userKey === null) {
      return undefined;
    }
    let isMounted = true;
    hasSeenHint(id, userKey)
      .then(seen => {
        if (isMounted) {
          setIsSeen(seen);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsSeen(true);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [id, userKey]);

  const wantsToShow = isEligible && isFocused && isSeen === false;

  // Take the single hint slot while wanting to show; give it back otherwise.
  useEffect(() => {
    if (!wantsToShow || (activeHint !== null && activeHint !== id)) {
      return undefined;
    }
    activeHint = id;
    setHasSlot(true);
    return () => {
      if (activeHint === id) {
        activeHint = null;
      }
      setHasSlot(false);
    };
  }, [id, wantsToShow]);

  const isVisible = wantsToShow && hasSlot;
  const userKeyRef = useRef(userKey);
  userKeyRef.current = userKey;

  const markSeen = useCallback(() => {
    setIsSeen(true);
    const key = userKeyRef.current;
    if (key !== null) {
      markHintSeen(id, key).catch(() => undefined);
    }
  }, [id]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }
    const timer = setTimeout(markSeen, HINT_VISIBLE_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [isVisible, markSeen]);

  return { isVisible, dismiss: markSeen, markPerformed: markSeen };
}

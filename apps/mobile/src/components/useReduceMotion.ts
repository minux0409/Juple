import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the system asks for reduced motion (iOS Reduce Motion, Android "Remove animations"), kept current while mounted.
 * Starts at false and is corrected as soon as the system answers; decorative motion should then settle on its end state at once.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (active) setReduceMotion(enabled); })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => setReduceMotion(enabled));
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduceMotion;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// Installation-scoped, not account-scoped. This is an explanation/decision marker, never an OS grant.
export const PERMISSION_REVIEW_KEY = 'juple.permissionReview.v1';
export function usePermissionOnboarding(enabled: boolean) {
  const [status, setStatus] = useState<'loading' | 'required' | 'done'>(
    'loading',
  );
  useEffect(() => {
    let current = true;
    if (!enabled)
      return () => {
        current = false;
      };
    AsyncStorage.getItem(PERMISSION_REVIEW_KEY).then(
      value => {
        if (current) setStatus(value === 'reviewed' ? 'done' : 'required');
      },
      () => {
        if (current) setStatus('required');
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);
  const complete = async () => {
    // Storage failure may cause a later explanation again, but may never trap the person here.
    await AsyncStorage.setItem(PERMISSION_REVIEW_KEY, 'reviewed').catch(
      () => undefined,
    );
    setStatus('done');
  };
  return { status, complete };
}

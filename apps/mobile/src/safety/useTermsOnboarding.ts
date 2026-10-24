import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { acceptTerms, getTermsStatus } from './safetyApi';

/**
 * Where the signed-in person stands with the CURRENT Terms (the server's account state, never a device flag):
 *   idle      not signed in / not bootstrapped yet - nothing is asked.
 *   checking  asking the server.
 *   required  the current version is not accepted - the Agreement screen comes before anything else.
 *   accepted  accepted - on to the tutorial / Home.
 *   error     the server could not be asked or answered unexpectedly - the person is never let through on a guess.
 * A new device or a later sign-in of the same account is already `accepted`; a newer version is `required` again.
 */
export type TermsOnboardingStatus = 'idle' | 'checking' | 'required' | 'accepted' | 'error';

export interface TermsOnboarding {
  readonly status: TermsOnboardingStatus;
  /** True while the acceptance request is in flight. */
  readonly isSaving: boolean;
  /** The last acceptance attempt failed (the Agreement screen says so and lets the person try again). */
  readonly saveFailed: boolean;
  readonly accept: () => Promise<void>;
  readonly retry: () => void;
}

export function useTermsOnboarding(enabled: boolean): TermsOnboarding {
  const request = useAuthenticatedApi();
  const [status, setStatus] = useState<TermsOnboardingStatus>('idle');
  const [attempt, setAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const version = useRef<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!enabled) {
      version.current = null;
      setStatus('idle');
      setSaveFailed(false);
      return undefined;
    }
    let active = true;
    setStatus('checking');
    getTermsStatus(request)
      .then(next => {
        if (!active) {
          return;
        }
        if (!next) {
          setStatus('error');
          return;
        }
        version.current = next.currentVersion;
        setStatus(next.isAccepted ? 'accepted' : 'required');
      })
      .catch(() => {
        if (active) {
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, [enabled, request, attempt]);

  const accept = useCallback(async () => {
    const current = version.current;
    if (saving.current || !current) {
      return;
    }
    saving.current = true;
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const result = await acceptTerms(request, current);
      if (result.currentVersion !== current) {
        // The policy changed while this screen was open. Retry fetches the new text/version instead of resending stale consent.
        setStatus('error');
      } else if (result.isAccepted) {
        setStatus('accepted');
      } else {
        setSaveFailed(true);
      }
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'badRequest') {
        // In particular, a stale Terms version must not trap the member on an endlessly failing submit button.
        setStatus('error');
      } else {
        setSaveFailed(true);
      }
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }, [request]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  return { status, isSaving, saveFailed, accept, retry };
}

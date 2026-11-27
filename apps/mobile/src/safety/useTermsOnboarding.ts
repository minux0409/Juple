import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { acceptTerms, getPublishedTerms, getTermsStatus } from './safetyApi';
import type { PublishedTermsDocument } from './termsDocument';

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
  readonly document: PublishedTermsDocument | null;
  readonly status: TermsOnboardingStatus;
  /** True while the acceptance request is in flight. */
  readonly isSaving: boolean;
  /** The last acceptance attempt failed (the Agreement screen says so and lets the person try again). */
  readonly saveFailed: boolean;
  readonly accept: () => Promise<void>;
  readonly retry: () => void;
  /**
   * Only when no approved text exists in the app language: the person explicitly chooses to read - and then agree to - the Korean
   * original. The Korean document is fetched and shown; the agreement carries its own version, hash and language ('ko').
   */
  readonly readKoreanOriginal: () => void;
}

export function useTermsOnboarding(enabled: boolean): TermsOnboarding {
  const { i18n } = useTranslation();
  const appLanguage = i18n.resolvedLanguage || 'en';
  // The person's explicit choice of the Korean original (never automatic); a new sign-in or app language starts from the app language again.
  const [koreanOriginal, setKoreanOriginal] = useState(false);
  const language = koreanOriginal ? 'ko' : appLanguage;
  const [document, setDocument] = useState<PublishedTermsDocument | null>(null);
  const request = useAuthenticatedApi();
  const [status, setStatus] = useState<TermsOnboardingStatus>('idle');
  const [attempt, setAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const version = useRef<string | null>(null);
  const saving = useRef(false);
  const lifetime = useRef({ active: false });
  // Read (not depended on) by the status check: the language only decides which TEXT of a still-required version is shown (the
  // effect below). Re-running the status check on a language change used to drop an already-accepted account back to 'checking',
  // which tore down and re-mounted every signed-in screen (RootStack's group) - jumping to Home and crashing Android's native
  // header (react-native-screens: "The specified child already has a parent") while the open screen's header was being rebuilt.
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    const run = { active: enabled };
    lifetime.current = run;
    version.current = null;
    saving.current = false;
    setIsSaving(false);
    if (!enabled) {
      setDocument(null);
      version.current = null;
      setStatus('idle');
      setSaveFailed(false);
      setKoreanOriginal(false);
      return undefined;
    }
    let active = true;
    setDocument(null);
    setStatus('checking');
    getTermsStatus(request)
      .then(async next => {
        if (!active) {
          return;
        }
        if (!next) {
          setStatus('error');
          return;
        }
        version.current = next.currentVersion;
        if (!next.isAccepted) {
          const published = await getPublishedTerms(request, next.currentVersion, languageRef.current);
          if (!active) return;
          setDocument(published);
        }
        setStatus(next.isAccepted ? 'accepted' : 'required');
      })
      .catch(() => {
        if (active) {
          setStatus('error');
        }
      });
    return () => {
      active = false;
      run.active = false;
    };
  }, [enabled, request, attempt]);

  // While the current version still has to be agreed to, a different language (or the explicit Korean original) only swaps the
  // text: the Agreement screen stays, nothing else re-mounts. The old text cannot be agreed to meanwhile (accept() requires the
  // document of the current language), and a failed fetch is an error exactly like the first one.
  useEffect(() => {
    const current = version.current;
    if (status !== 'required' || !current || document?.requestedLanguage === language) {
      return undefined;
    }
    let active = true;
    setDocument(null);
    getPublishedTerms(request, current, language)
      .then(published => {
        if (active) {
          setDocument(published);
        }
      })
      .catch(() => {
        if (active) {
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
    // `document` is deliberately left out: setting it here must not start another fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, request, language]);

  const accept = useCallback(async () => {
    const current = version.current;
    if (saving.current || !current || !enabled || !document?.canAccept || document.version !== current || document.requestedLanguage !== language || document.language !== language) {
      return;
    }
    saving.current = true;
    const run = lifetime.current;
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const result = await acceptTerms(request, current, document.contentHash, document.language);
      if (!run.active || lifetime.current !== run || version.current !== current) return;
      if (result.currentVersion !== current) {
        // The policy changed while this screen was open. Retry fetches the new text/version instead of resending stale consent.
        setStatus('error');
      } else if (result.isAccepted) {
        setStatus('accepted');
      } else {
        setSaveFailed(true);
      }
    } catch (error) {
      if (!run.active || lifetime.current !== run) return;
      if (error instanceof ApiError && error.kind === 'badRequest') {
        // In particular, a stale Terms version must not trap the member on an endlessly failing submit button.
        setStatus('error');
      } else {
        setSaveFailed(true);
      }
    } finally {
      if (run.active && lifetime.current === run) {
        saving.current = false;
        setIsSaving(false);
      }
    }
  }, [request, document, enabled, language]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const readKoreanOriginal = useCallback(() => setKoreanOriginal(true), []);
  useEffect(() => setKoreanOriginal(false), [appLanguage]);

  return { status, isSaving, saveFailed, accept, retry, readKoreanOriginal, document };
}

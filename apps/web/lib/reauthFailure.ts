import { describeSignInError } from './authErrors.ts';
import type { ReauthenticationPurpose, ReauthenticationResult } from './msalClient.ts';

/** MSAL's own code when the person leaves the fresh sign-in (browser back, closing it): an expected outcome, never an error. */
export const USER_CANCELLED_CODE = 'user_cancelled';

export function isUserCancelled(error: unknown): boolean {
  return describeSignInError(error).errorCode === USER_CANCELLED_CODE;
}

/**
 * A fresh sign-in (비밀번호 재설정, 컬렉션 잠금 설정 / 재설정, 계정 삭제) that did not complete. The ONE branch is the person's own
 * cancellation: the session simply continues on the page they came from - the pending marker is removed, nothing is logged or shown,
 * and no failure result is handed to the page. Any other failure keeps its development report and the "incomplete" outcome.
 */
export function settleReauthenticationFailure(
  error: unknown,
  purpose: ReauthenticationPurpose,
  actions: {
    readonly clearMarker: () => void;
    readonly report: (step: string, error: unknown) => void;
    readonly setResult: (result: ReauthenticationResult) => void;
    readonly backToReady: () => void;
  },
): 'cancelled' | 'failed' {
  if (isUserCancelled(error)) {
    actions.clearMarker();
    actions.backToReady();
    return 'cancelled';
  }
  actions.report('reauthenticate', error);
  actions.setResult({ purpose, outcome: 'incomplete' });
  actions.backToReady();
  return 'failed';
}

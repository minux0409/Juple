import type { BackendAuthStatus, UserBootstrapStatus } from './types';
import type { SessionRestoreStep } from './session/authSessionManager';

/**
 * The real, ordered stages app bootstrap goes through on a cold start - drives the Startup
 * Progress UI's single message line + determinate bar (see StartupProgressScreen.tsx). Every
 * transition here corresponds to an actual async boundary already crossed by AuthContext's
 * runBootstrap (session restore -> Entra refresh -> backend session validation -> user
 * bootstrap -> ready) - never advanced by a timer.
 */
export type BootstrapStep =
  | 'sessionRestore'
  | 'entraRefresh'
  | 'backendValidation'
  | 'userBootstrap'
  | 'ready';

const STEP_ORDER: readonly BootstrapStep[] = [
  'sessionRestore',
  'entraRefresh',
  'backendValidation',
  'userBootstrap',
  'ready',
];

export const STEP_MESSAGE_KEYS: Readonly<Record<BootstrapStep, string>> = {
  sessionRestore: 'auth.progressCheckingLogin',
  // Session restore and the Entra refresh that usually follows it are both, from the user's
  // perspective, "checking your login" - they share one message while the bar still advances
  // between them (see bootstrapStepFraction below).
  entraRefresh: 'auth.progressCheckingLogin',
  backendValidation: 'auth.progressConnectingServer',
  userBootstrap: 'auth.progressLoadingUser',
  ready: 'auth.progressReady',
};

export function bootstrapStepFraction(step: BootstrapStep): number {
  return (STEP_ORDER.indexOf(step) + 1) / STEP_ORDER.length;
}

export interface BootstrapProgressState {
  readonly sessionRestoreStep: SessionRestoreStep;
  readonly backendAuthStatus: BackendAuthStatus;
  readonly userBootstrapStatus: UserBootstrapStatus;
}

/** Pure mapping from AuthContext's real state to the single current bootstrap step. */
export function resolveBootstrapStep(state: BootstrapProgressState): BootstrapStep {
  if (state.userBootstrapStatus === 'ready') {
    return 'ready';
  }
  if (state.userBootstrapStatus === 'checking') {
    return 'userBootstrap';
  }
  if (state.backendAuthStatus === 'checking' || state.backendAuthStatus === 'valid') {
    return 'backendValidation';
  }
  return state.sessionRestoreStep;
}

export interface BootstrapErrorInfo {
  readonly messageKey: string;
  readonly canRetry: boolean;
}

/**
 * Null while bootstrap is still progressing normally. Only backendAuthStatus === 'unavailable' is
 * retryable in place (a transient failure restoring the session, or the Backend being briefly
 * unreachable - see AuthContext.tsx's runBootstrap) - the other rejected states require different
 * input (re-authenticating, or fixing device settings) that simply retrying cannot fix.
 */
export function resolveBootstrapError(state: BootstrapProgressState): BootstrapErrorInfo | null {
  if (state.userBootstrapStatus === 'invalidDeviceSettings') {
    return { messageKey: 'auth.bootstrapInvalidDeviceSettings', canRetry: false };
  }
  if (state.userBootstrapStatus === 'unavailable') {
    return { messageKey: 'auth.bootstrapUnavailable', canRetry: false };
  }
  if (state.backendAuthStatus === 'unauthorized') {
    return { messageKey: 'auth.backendUnauthorized', canRetry: false };
  }
  if (state.backendAuthStatus === 'forbidden') {
    return { messageKey: 'auth.backendForbidden', canRetry: false };
  }
  if (state.backendAuthStatus === 'unavailable') {
    return { messageKey: 'auth.backendUnavailable', canRetry: true };
  }
  return null;
}

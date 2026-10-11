import { requestApi } from '../api/apiClient';
import { parsePlatformVersionPolicy, type PlatformVersionPolicy } from './versionPolicy';

/** The sign-in-free policy request is a convenience, never a gate: a short ceiling so a slow network never holds anything up. */
const POLICY_TIMEOUT_MS = 5000;

export type FetchedUpdatePolicy =
  /** The server answered: its policy for this platform, or null when it has none (disabled / unusable). */
  | { readonly ok: true; readonly policy: PlatformVersionPolicy | null }
  /** Nothing usable came back (offline, timeout, server error, a shape this build does not know). Fail open: the app carries on. */
  | { readonly ok: false };

/**
 * Reads this platform's update policy WITHOUT signing in (GET /api/v1/app-update/{platform}). The same single server source as the
 * bootstrap response's `mobileVersionPolicy`; this path just makes it available on the sign-in screen and before bootstrap.
 * Never throws: every failure is `{ ok: false }`, and the caller leaves the app usable.
 */
export async function fetchAppUpdatePolicy(platform: string): Promise<FetchedUpdatePolicy> {
  if (platform !== 'android' && platform !== 'ios') {
    return { ok: false };
  }
  try {
    const response = await requestApi<Record<string, unknown>>({ method: 'GET', path: `/api/v1/app-update/${platform}`, timeoutMs: POLICY_TIMEOUT_MS });
    const body = response.body;
    if (typeof body !== 'object' || body === null || typeof body.enabled !== 'boolean') {
      return { ok: false };
    }
    if (body.enabled === false) {
      return { ok: true, policy: null };
    }
    const policy = parsePlatformVersionPolicy(body);
    // Enabled but unusable (a minimum above the latest, a malformed number): treated as no answer - never as a guess.
    return policy === null ? { ok: false } : { ok: true, policy };
  } catch {
    return { ok: false };
  }
}

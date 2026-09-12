import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { checkUrlSafety } from './api/urlSafetyApi';

/**
 * Best-effort, fire-and-forget-shaped URL safety check for Quick Save ON's headless flow (see
 * incomingShareHeadlessTask.ts) - never blocks or affects the save, and its own try/catch means it
 * never throws. The Item is already saved by the time this runs.
 *
 * Deliberately does not persist the result anywhere (Safety status has no Item-level storage yet -
 * first round keeps this cache/on-demand only, see docs on UrlSafety) and shows no UI (Quick Save
 * ON is headless by design - no UI is reintroduced here). The only observable effect is a
 * privacy-safe diagnostic log (status only, never the URL) so a ThreatDetected outcome is at least
 * visible in logs even though there is nowhere yet to surface it to the user for this save path.
 */
export async function checkUrlSafetyBestEffort(request: AuthenticatedApiRequest, url: string): Promise<void> {
  try {
    const result = await checkUrlSafety(request, url);
    if (result.status === 'threatDetected') {
      console.warn('[checkUrlSafetyBestEffort] threat detected', { threatCount: result.threats.length });
    }
  } catch (error) {
    console.warn('[checkUrlSafetyBestEffort] failed', {
      errorKind: error instanceof ApiError ? error.kind : undefined,
      errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
    });
  }
}

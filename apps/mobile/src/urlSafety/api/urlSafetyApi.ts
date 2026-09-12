import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export type UrlSafetyStatus = 'threatDetected' | 'noKnownThreat' | 'checkUnavailable';
export type UrlThreatCategory = 'malware' | 'socialEngineering' | 'unwantedSoftware' | 'other';

export interface UrlSafetyCheckResult {
  readonly status: UrlSafetyStatus;
  readonly threats: readonly UrlThreatCategory[];
}

/**
 * Threat lookup for a user-supplied URL, resolved server-side against an external provider (see
 * backend UrlSafetyController/WebRiskUrlSafetyChecker) - Mobile never calls a safety provider
 * directly. `noKnownThreat` means no known threat was found at check time, never a guarantee the
 * URL is safe - see UrlSafetyStatus's own remarks on the backend.
 */
export async function checkUrlSafety(
  request: AuthenticatedApiRequest,
  url: string,
): Promise<UrlSafetyCheckResult> {
  const response = await request<UrlSafetyCheckResult>({
    method: 'POST',
    path: '/api/v1/url-safety/check',
    body: { url },
  });

  if (!response.body) {
    throw new Error('Juple API returned no URL safety result.');
  }

  return response.body;
}

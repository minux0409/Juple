import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export type UrlMetadataSource = 'openGraph' | 'twitter' | 'htmlTitle';

export interface ResolvedUrlMetadata {
  readonly title: string | null;
  readonly source: UrlMetadataSource | null;
}

/**
 * Best-effort URL metadata (currently: title only) resolved server-side with SSRF protection -
 * see backend UrlMetadataController/UrlMetadataResolver. Resolves with a (possibly null) title for
 * every ordinary "no title found"/blocked/unreachable outcome rather than throwing for those -
 * callers still need to handle a genuine transport/auth failure surfaced by `request` itself
 * (ApiError), since this is not itself a try/catch wrapper - see enrichItemTitleFromUrlMetadata for
 * the best-effort wrapper used by the save flows.
 */
export async function resolveUrlMetadata(
  request: AuthenticatedApiRequest,
  url: string,
): Promise<ResolvedUrlMetadata> {
  const response = await request<ResolvedUrlMetadata>({
    method: 'POST',
    path: '/api/v1/url-metadata/resolve',
    body: { url },
  });

  if (!response.body) {
    throw new Error('Juple API returned no URL metadata body.');
  }

  return response.body;
}

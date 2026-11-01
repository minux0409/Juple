import type { AuthenticatedApiRequest } from '../api/authenticatedApiClient';

/**
 * The operators' messages to this person (GET /api/v1/moderation-notices/{id}): an 이용 안내 with the operator's reviewed reason and
 * guidance, or the generic result of their own report. Only their own notice exists for them; the words are shown as plain text.
 */
export interface ModerationNotice {
  readonly id: number;
  readonly kind: 'warning' | 'reportResult';
  readonly reason: string | null;
  readonly guidance: string | null;
  readonly createdAtUtc: string;
  readonly acknowledgedAtUtc: string | null;
}

const noticePath = (id: number) => `/api/v1/moderation-notices/${encodeURIComponent(String(id))}`;

/** Untrusted input: anything that is not a recognizable notice is null. */
export function parseModerationNotice(raw: unknown): ModerationNotice | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'number' || (value.kind !== 'warning' && value.kind !== 'reportResult') || typeof value.createdAtUtc !== 'string') {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    reason: typeof value.reason === 'string' ? value.reason : null,
    guidance: typeof value.guidance === 'string' ? value.guidance : null,
    createdAtUtc: value.createdAtUtc,
    acknowledgedAtUtc: typeof value.acknowledgedAtUtc === 'string' ? value.acknowledgedAtUtc : null,
  };
}

export async function getModerationNotice(request: AuthenticatedApiRequest, id: number): Promise<ModerationNotice | null> {
  const response = await request<unknown>({ method: 'GET', path: noticePath(id) });
  return parseModerationNotice(response.body);
}

export async function acknowledgeModerationNotice(request: AuthenticatedApiRequest, id: number): Promise<void> {
  await request<void>({ method: 'POST', path: `${noticePath(id)}/acknowledge` });
}

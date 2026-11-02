import type { AuthenticatedApiRequest } from '../api/authenticatedApiClient';

/**
 * The operators' messages to this person (GET /api/v1/moderation-notices/{id}): a warning with the operator's reviewed reason and guidance, an
 * ACTION notice (a link or Collection deleted / restored, its sharing restricted / lifted, the account's use restricted / lifted - a snapshot of what
 * and to what, so it is readable after the content is gone), or the generic result of their own report. Only their own notice exists for them; the
 * words are shown as plain text.
 */
export type ModerationActionType =
  | 'contentDeleted'
  | 'contentRemovedFromCollection'
  | 'contentRestored'
  | 'shareRestricted'
  | 'shareRestrictionLifted'
  | 'accountRestricted'
  | 'accountRestrictionLifted';

const ACTION_TYPES: ReadonlySet<string> = new Set<ModerationActionType>([
  'contentDeleted',
  'contentRemovedFromCollection',
  'contentRestored',
  'shareRestricted',
  'shareRestrictionLifted',
  'accountRestricted',
  'accountRestrictionLifted',
]);

export interface ModerationNotice {
  readonly id: number;
  readonly kind: 'warning' | 'action' | 'reportResult';
  readonly reason: string | null;
  readonly guidance: string | null;
  readonly createdAtUtc: string;
  readonly acknowledgedAtUtc: string | null;
  /** kind = action only. */
  readonly actionType: ModerationActionType | null;
  /** The title of the content it is about, as it was at that moment. */
  readonly contentTitle: string | null;
  /** 'Item' (a link) or 'Collection'. */
  readonly contentType: 'Item' | 'Collection' | null;
  /** The report's reason code (Spam, Harassment...), worded in the person's language by the app. */
  readonly reasonCode: string | null;
  /** A link's preview picture, as it was at that moment. */
  readonly contentImageUrl: string | null;
  /** The shared Collection a link was in, as it was named at that moment. */
  readonly collectionName: string | null;
}

const noticePath = (id: number) => `/api/v1/moderation-notices/${encodeURIComponent(String(id))}`;

/** Untrusted input: anything that is not a recognizable notice is null. */
export function parseModerationNotice(raw: unknown): ModerationNotice | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'number' || (value.kind !== 'warning' && value.kind !== 'action' && value.kind !== 'reportResult') || typeof value.createdAtUtc !== 'string') {
    return null;
  }
  const actionType = typeof value.actionType === 'string' && ACTION_TYPES.has(value.actionType) ? (value.actionType as ModerationActionType) : null;
  if (value.kind === 'action' && actionType === null) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    reason: typeof value.reason === 'string' ? value.reason : null,
    guidance: typeof value.guidance === 'string' ? value.guidance : null,
    createdAtUtc: value.createdAtUtc,
    acknowledgedAtUtc: typeof value.acknowledgedAtUtc === 'string' ? value.acknowledgedAtUtc : null,
    actionType,
    contentTitle: typeof value.contentTitle === 'string' ? value.contentTitle : null,
    contentType: value.contentType === 'Item' || value.contentType === 'Collection' ? value.contentType : null,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : null,
    contentImageUrl: typeof value.contentImageUrl === 'string' ? value.contentImageUrl : null,
    collectionName: typeof value.collectionName === 'string' ? value.collectionName : null,
  };
}

export async function getModerationNotice(request: AuthenticatedApiRequest, id: number): Promise<ModerationNotice | null> {
  const response = await request<unknown>({ method: 'GET', path: noticePath(id) });
  return parseModerationNotice(response.body);
}

export async function acknowledgeModerationNotice(request: AuthenticatedApiRequest, id: number): Promise<void> {
  await request<void>({ method: 'POST', path: `${noticePath(id)}/acknowledge` });
}

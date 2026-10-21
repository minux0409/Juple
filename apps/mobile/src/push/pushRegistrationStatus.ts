export type PushSyncStatus =
  | 'idle'
  | 'permissionDenied'
  | 'permissionUnavailable'
  | 'tokenUnavailable'
  | 'tokenFailed'
  | 'registrationFailed'
  | 'registered'
  | 'apnsNotReady'
  | 'cancelled';
export interface PushSyncReport {
  readonly status: PushSyncStatus;
  readonly checkedAtUtc: string;
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;
}
let latest: PushSyncReport = {
  status: 'idle',
  checkedAtUtc: new Date().toISOString(),
};
const listeners = new Set<(report: PushSyncReport) => void>();
export const getPushSyncReport = () => latest;
export function reportPushSync(
  status: PushSyncStatus,
  httpStatus?: number,
  retryAfterSeconds?: number,
): PushSyncStatus {
  latest = {
    status,
    checkedAtUtc: new Date().toISOString(),
    ...(httpStatus ? { httpStatus } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
  };
  for (const listener of listeners) listener(latest);
  // Only bounded outcome/status fields. Never log tokens, identities, raw exceptions or response bodies.
  if (status !== 'idle' && status !== 'cancelled')
    console.info('[Juple push registration]', latest);
  return status;
}
export function subscribePushSync(
  listener: (report: PushSyncReport) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

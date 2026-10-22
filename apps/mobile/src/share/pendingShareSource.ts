import NativeIncomingShare, { type PendingShare } from './specs/NativeIncomingShare';
import NativeIncomingShareIOS from './specs/NativeIncomingShareIOS';

/**
 * Where links shared from other apps wait for the app (the one queue useIncomingShare reads):
 *  - Android: NativeIncomingShare's queue (ShareReceiverActivity, Quick Save, Direct Share) - unchanged;
 *  - iOS: the Juple Share extension's App Group queue (NativeIncomingShareIOS). iOS has no Direct Share or Quick Save, so its
 *    shares never name a Collection and are never saved in the background: they always open 새 링크 검토.
 * Null where neither exists.
 */
export interface PendingShareSource {
  readonly getPendingShares: () => Promise<readonly PendingShare[]>;
  readonly acknowledgePendingShare: (id: string) => Promise<void>;
}

/** The iOS queue's JSON as PendingShares: anything malformed is skipped, never thrown. */
export function parseIosPendingShares(json: string | null | undefined): PendingShare[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((entry): PendingShare[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const { id, text, receivedAtEpochMs, initialTitle } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof text !== 'string' || !text.trim() || typeof receivedAtEpochMs !== 'number' || !Number.isFinite(receivedAtEpochMs)) {
      return [];
    }
    return [
      {
        id,
        text,
        receivedAtEpochMs,
        initialTitle: typeof initialTitle === 'string' && initialTitle.trim() ? initialTitle : null,
        preselectedCollectionId: null,
        draftTitle: null,
        draftCollectionId: null,
      },
    ];
  });
}

function resolveSource(): PendingShareSource | null {
  if (NativeIncomingShare) {
    const android = NativeIncomingShare;
    return {
      getPendingShares: () => android.getPendingShares(),
      acknowledgePendingShare: id => android.acknowledgePendingShare(id),
    };
  }
  if (NativeIncomingShareIOS) {
    const ios = NativeIncomingShareIOS;
    return {
      getPendingShares: async () => parseIosPendingShares(await ios.getPendingSharesJson()),
      acknowledgePendingShare: id => ios.acknowledgePendingShare(id),
    };
  }
  return null;
}

export const pendingShareSource: PendingShareSource | null = resolveSource();

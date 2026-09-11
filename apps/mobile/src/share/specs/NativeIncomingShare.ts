import type { TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

export interface PendingShare {
  readonly id: string;
  readonly text: string;
  readonly receivedAtEpochMs: number;
  /** Best-effort title from the sharing app's own Intent (EXTRA_SUBJECT/EXTRA_TITLE) - null when it provided none. Never a network-fetched value. */
  readonly initialTitle: string | null;
  /** Resolved from a matched Direct Share category shortcut at share time; null for the generic Juple target - only consumed by the Quick Save OFF review screen (NewLinkReviewScreen), never applied automatically by the ON immediate-save path. */
  readonly preselectedCollectionId: number | null;
  /** Always null - reserved wire-format field, kept for native queue schema compatibility with a since-removed Quick Save composer draft. */
  readonly draftTitle: string | null;
  readonly draftCollectionId: number | null;
}

export interface CategorySnapshotEntry {
  readonly id: number;
  readonly name: string;
  readonly isFavorite: boolean;
}

export interface Spec extends TurboModule {
  getPendingShares(): Promise<ReadonlyArray<PendingShare>>;
  acknowledgePendingShare(id: string): Promise<void>;
  /**
   * Reports why a share is still pending after a save attempt, so the native retry Worker can
   * decide whether to retry. `outcome` is one of: reviewRequired, authenticationRequired,
   * retryableFailure, permanentFailure. Not called on success - removal from the pending queue
   * (via acknowledgePendingShare) is itself the success signal.
   */
  reportAttemptOutcome(pendingShareId: string, outcome: string): Promise<void>;
  /**
   * Mirrors the "quick save on share" JS preference into native SharedPreferences, so
   * ShareReceiverActivity can read it synchronously (no JS/bridge guaranteed to be running yet)
   * when deciding whether to save immediately or bring the app to the foreground for review.
   */
  setQuickSaveOnShare(enabled: boolean): Promise<void>;
  /** Native-cached Collection list backing Direct Share category shortcuts - never a live API call. */
  getCategorySnapshot(): Promise<ReadonlyArray<CategorySnapshotEntry>>;
  /**
   * Overwrites the native category snapshot and republishes Direct Share dynamic shortcuts from
   * it (see categorySnapshotSync.ts). `categoriesJson` is `JSON.stringify(CategorySnapshotEntry[])`
   * - a plain string, not a codegen struct array, to keep this parameter direction (JS -> native)
   * on the one object-passing shape already proven safe in this bridge.
   */
  setCategorySnapshot(categoriesJson: string): Promise<void>;
  /** Removes all Direct Share category shortcuts and clears the native category snapshot - called on logout/account deletion so another account never sees a previous user's categories. */
  clearCategoryShortcuts(): Promise<void>;
}

const nativeIncomingShare =
  Platform.OS === 'android'
    ? TurboModuleRegistry.getEnforcing<Spec>('NativeIncomingShare')
    : null;

export default nativeIncomingShare;

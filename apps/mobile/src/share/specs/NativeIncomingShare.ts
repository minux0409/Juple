import type { TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

export interface PendingShare {
  readonly id: string;
  readonly text: string;
  readonly receivedAtEpochMs: number;
  /** Best-effort title from the sharing app's own Intent (EXTRA_SUBJECT/EXTRA_TITLE) - null when it provided none. Never a network-fetched value. */
  readonly initialTitle: string | null;
  /** Resolved from a matched Direct Share category shortcut at share time; null for the generic Juple target. */
  readonly preselectedCollectionId: number | null;
  /** Set only once the user confirms Save in the Quick Save composer; null until then. */
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
   * when deciding whether to open the Quick Save composer or bring the app to the foreground for
   * review.
   */
  setQuickSaveOnShare(enabled: boolean): Promise<void>;
  /** Native-cached Collection list for the Quick Save composer's category picker - never a live API call, so the picker renders instantly even before any auth/network round trip resolves. */
  getCategorySnapshot(): Promise<ReadonlyArray<CategorySnapshotEntry>>;
  /**
   * Overwrites the native category snapshot and republishes Direct Share dynamic shortcuts from
   * it (see categorySnapshotSync.ts). `categoriesJson` is `JSON.stringify(CategorySnapshotEntry[])`
   * - a plain string, not a codegen struct array, to keep this parameter direction (JS -> native)
   * on the one object-passing shape already proven safe in this bridge.
   */
  setCategorySnapshot(categoriesJson: string): Promise<void>;
  /**
   * Records the user-confirmed title/category for a pending share and schedules the durable
   * background save (the same WorkManager fallback + immediate headless-task attempt
   * ShareReceiverActivity used to trigger unconditionally) - nothing calls the Item API before
   * this is called. `collectionId` is NO_COLLECTION_ID when no category was selected.
   */
  submitQuickSaveDraft(pendingShareId: string, title: string, collectionId: number): Promise<void>;
  /**
   * Polls the outcome of a submitted draft: 'pending' (still in flight / not yet attempted),
   * 'success' (no longer in the pending queue), or one of the reportAttemptOutcome values.
   */
  getQuickSaveOutcome(pendingShareId: string): Promise<string>;
  /** Closes the currently-foregrounded Quick Save composer Activity. */
  finishComposerActivity(): Promise<void>;
  /** Removes all Direct Share category shortcuts and clears the native category snapshot - called on logout/account deletion so another account never sees a previous user's categories. */
  clearCategoryShortcuts(): Promise<void>;
}

const nativeIncomingShare =
  Platform.OS === 'android'
    ? TurboModuleRegistry.getEnforcing<Spec>('NativeIncomingShare')
    : null;

export default nativeIncomingShare;

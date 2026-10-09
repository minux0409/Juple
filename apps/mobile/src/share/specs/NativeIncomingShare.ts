import type { TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

export interface PendingShare {
  readonly id: string;
  readonly text: string;
  readonly receivedAtEpochMs: number;
  /** Best-effort title from the sharing app's own Intent (EXTRA_SUBJECT/EXTRA_TITLE) - null when it provided none. Never a network-fetched value. */
  readonly initialTitle: string | null;
  /**
   * The Collection a Direct Share row named at share time (one the user pinned); null for the generic Juple target. Only a
   * CLAIM: every consumer re-validates it with the backend (existence, access, role, lock) before using it - the Quick Save
   * ON headless save to save into it, the Quick Save OFF router to preselect it in NewLinkReview.
   */
  readonly preselectedCollectionId: number | null;
  /** Always null - reserved wire-format field, kept for native queue schema compatibility with a since-removed Quick Save composer draft. */
  readonly draftTitle: string | null;
  readonly draftCollectionId: number | null;
  /**
   * Captured with Quick Save ON, so a background save was started for it immediately. Absent on a
   * share queued by an older build (treated as false).
   */
  readonly autoSave?: boolean;
  /**
   * The last reported outcome of that background save while the share is still pending
   * (reviewRequired, authenticationRequired, retryableFailure, permanentFailure), or null while no
   * attempt has ended yet - a successful save removes the share instead.
   */
  readonly autoSaveOutcome?: string | null;
}

/** A Collection the user explicitly added to the app shortcuts (device-local; see CollectionShortcutService). */
export interface PinnedCollectionShortcut {
  readonly id: number;
  readonly name: string;
  /**
   * What the Collection's shortcut icon is drawn from - the SAME data its card shows: the configured icon key and the card's tile /
   * glyph colors, and the version of its own photo (iconImageVersion). Optional: entries stored by an older build have none.
   */
  readonly iconKey?: string | null;
  readonly tileColor?: string | null;
  readonly glyphColor?: string | null;
  readonly imageVersion?: string | null;
}

/** What a launcher-shortcut tap / a failed Direct Share left for JS to act on - consumed exactly once. */
export interface ShortcutLaunch {
  /** A launcher shortcut for this Collection was tapped; NOT trusted - the app re-reads the Collection before opening it. */
  readonly openCollectionId: number | null;
  /** A notice code for a message to show (see shortcutLaunchNotice.ts), or null. */
  readonly notice: string | null;
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
  /** The Collections the user pinned as app shortcuts, as stored on this device - never a live API call. */
  getPinnedCollectionShortcuts(): Promise<ReadonlyArray<PinnedCollectionShortcut>>;
  /**
   * Replaces the whole pinned set and republishes the launcher + Direct Share shortcuts from it (one call, so a removed or
   * renamed Collection never leaves a stale shortcut). `pinnedJson` is `JSON.stringify(PinnedCollectionShortcut[])` - a plain
   * string, not a codegen struct array, to keep this parameter direction (JS -> native) on the one object-passing shape
   * already proven safe in this bridge.
   */
  setPinnedCollectionShortcuts(pinnedJson: string): Promise<void>;
  /** The platform's limit for shortcuts of this app. */
  getMaxPinnedCollectionShortcuts(): Promise<number>;
  /** Removes every pinned shortcut and clears the stored set - on sign-out / account change, so another account never sees a previous user's Collection names. */
  clearPinnedCollectionShortcuts(): Promise<void>;
  /** Takes (and forgets) what a launcher-shortcut tap / a failed Direct Share left for the app. */
  consumeShortcutLaunch(): Promise<ShortcutLaunch>;
  /** Whether this launcher can add a shortcut to the Home screen (Android's requestPinShortcut). */
  isHomeShortcutSupported(): Promise<boolean>;
  /**
   * Asks the launcher - through Android's own system dialog - for a real 1x1 Home-screen icon of the Collection (its photo, else its
   * configured icon on its color, else the initial of its name; label = its name). `imageUrl` is the signed read link the card is
   * showing - used once to prepare the photo, never stored or put in an Intent; empty strings mean "none". Resolves 'requested' once the dialog was shown (NOT that the user accepted) or
   * 'unsupported'. When `shareable`, the Collection also becomes a Direct Share destination - but only if/when the launcher
   * reports the user accepted; a cancelled dialog changes nothing.
   */
  requestHomeShortcut(
    collectionId: number,
    name: string,
    iconKey: string,
    tileColor: string,
    glyphColor: string,
    imageUrl: string,
    imageVersion: string,
    shareable: boolean,
  ): Promise<string>;
  /** Leaves a notice code for the app to show next time it is in front (see shortcutLaunchNotice.ts). */
  setShortcutNotice(code: string): Promise<void>;
}

const nativeIncomingShare =
  Platform.OS === 'android'
    ? TurboModuleRegistry.getEnforcing<Spec>('NativeIncomingShare')
    : null;

export default nativeIncomingShare;

import type { TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

export interface PendingShare {
  readonly id: string;
  readonly text: string;
  readonly receivedAtEpochMs: number;
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
   * when deciding whether to silently save or bring the app to the foreground for review.
   */
  setQuickSaveOnShare(enabled: boolean): Promise<void>;
}

const nativeIncomingShare =
  Platform.OS === 'android'
    ? TurboModuleRegistry.getEnforcing<Spec>('NativeIncomingShare')
    : null;

export default nativeIncomingShare;

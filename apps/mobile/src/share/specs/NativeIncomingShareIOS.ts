import type { TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

/**
 * iOS-only (null elsewhere; the "IOS" name suffix keeps it out of Android codegen): the links the Juple Share extension handed to
 * the app (ios/Shared/PendingShareStore.swift, an App Group file) - only those the extension could not save itself (signed out, offline,
 * a Juple Collection link) - and the 빠른 저장 switch the extension reads. There is no shortcut or Direct Share on iOS.
 */
export interface Spec extends TurboModule {
  /** The waiting shares as JSON: `[{ id, text, receivedAtEpochMs, initialTitle? }]`, oldest first. */
  getPendingSharesJson(): Promise<string>;
  /** Removes one share once the app has taken it. */
  acknowledgePendingShare(id: string): Promise<void>;
  /** Mirrors the app's 빠른 저장 switch to the App Group, where the Share extension reads it (not a secret). */
  setQuickSaveOnShare(enabled: boolean): Promise<void>;
}

const nativeIncomingShareIOS = Platform.OS === 'ios' ? TurboModuleRegistry.get<Spec>('NativeIncomingShareIOS') : null;

export default nativeIncomingShareIOS;

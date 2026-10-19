import type { CodegenTypes, TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

/**
 * iOS-only (null elsewhere, like NativeIncomingShare is Android-only): the app's side of the "컬렉션 열기" App Intent that a
 * person adds to the Home screen through the Shortcuts app. iOS has no API for an app to create a Home-screen icon itself.
 * The "IOS" name suffix is what keeps it out of Android: codegen marks such a module `excludedPlatforms: ['android']`, so no
 * Java/JNI spec is generated (only the shared, header-only JupleSpecsJSI.h mentions it). A ".ios.ts" file name would not work:
 * RN 0.87's iOS codegen drops platform-suffixed spec files.
 */

/** What an "컬렉션 열기" run left for JS - consumed exactly once. Same shape as Android's ShortcutLaunch. */
export interface ShortcutLaunch {
  /** The Collection the shortcut names; NOT trusted - the app re-reads it with the current account before opening it. */
  readonly openCollectionId: number | null;
  /** A notice code (see shortcutLaunchNotice.ts), or null. Always null today; kept for the shared shape. */
  readonly notice: string | null;
}

export interface Spec extends TurboModule {
  /** Takes (and forgets) the Collection an "컬렉션 열기" run asked for. */
  consumeShortcutLaunch(): Promise<ShortcutLaunch>;
  /**
   * Replaces the Collections the Shortcuts app may offer in "컬렉션 열기" - only those the person added from the app.
   * `collectionsJson` is `JSON.stringify({ id: number; name: string }[])`.
   */
  setShortcutCollections(collectionsJson: string): Promise<void>;
  /** The offered Collections as stored on this device, as the same JSON `setShortcutCollections` takes. */
  getShortcutCollections(): Promise<string>;
  /** Forgets every offered Collection and any pending launch - on sign-out, so another account never sees them. */
  clearShortcutCollections(): Promise<void>;
  /** Fires when an "컬렉션 열기" run left a launch while the app is already running (the payload is always ""). */
  readonly onShortcutLaunch: CodegenTypes.EventEmitter<string>;
}

const nativeCollectionShortcutsIOS = Platform.OS === 'ios' ? TurboModuleRegistry.get<Spec>('NativeCollectionShortcutsIOS') : null;

export default nativeCollectionShortcutsIOS;

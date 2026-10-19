import NativeCollectionShortcutsIOS from '../share/specs/NativeCollectionShortcutsIOS';
import NativeIncomingShare from '../share/specs/NativeIncomingShare';

/** What an OS shortcut hand-off left for the app (Android launcher icon / Direct Share notice, iOS "컬렉션 열기"). */
export interface ShortcutLaunch {
  /** NOT trusted - CollectionShortcutRouter re-reads the Collection with the current account before opening it. */
  readonly openCollectionId: number | null;
  readonly notice: string | null;
}

/** Takes (and forgets) what the platform's shortcut hand-off left, or null where there is none. */
export async function consumeShortcutLaunch(): Promise<ShortcutLaunch | null> {
  if (NativeIncomingShare) {
    return NativeIncomingShare.consumeShortcutLaunch();
  }
  if (NativeCollectionShortcutsIOS) {
    return NativeCollectionShortcutsIOS.consumeShortcutLaunch();
  }
  return null;
}

/**
 * Calls `onLaunch` when a launch is left while the app is already running. iOS only: an "컬렉션 열기" run can finish after the
 * app came to the front. Android's launch always arrives with the activity coming to the front (AppState covers it).
 */
export function subscribeShortcutLaunch(onLaunch: () => void): () => void {
  if (!NativeCollectionShortcutsIOS) {
    return () => undefined;
  }
  const subscription = NativeCollectionShortcutsIOS.onShortcutLaunch(() => onLaunch());
  return () => subscription.remove();
}

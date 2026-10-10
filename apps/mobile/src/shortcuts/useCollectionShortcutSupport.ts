import { useCallback, useEffect, useRef, useState } from 'react';
import { collectionShortcutService } from './CollectionShortcutService';

export type HomePinSupport = 'unknown' | 'supported' | 'unsupported';

export interface CollectionShortcutSupport {
  /** The native module exists (Direct Share targets can be offered). Never a guess from the operating system name. */
  readonly directShareSupported: boolean;
  /** Native support AND this launcher can pin Home-screen icons. `unknown` until the launcher has answered. */
  readonly homePinSupport: HomePinSupport;
  /** Asks the launcher again (no cache) - the Collection menu calls this every time it opens. */
  readonly refreshHomePinSupport: () => Promise<void>;
}

/**
 * The ONE source of what this device can do with Collection shortcuts, shared by the Collection long-press menu and
 * the Help Guide. Deliberately not cached across mounts: every `refreshHomePinSupport()` re-queries the launcher, so
 * the menu keeps its current behavior. A rejected launcher call is `unsupported`. Whether one Collection is currently
 * a Direct Share target (`isPinned`) is Collection-specific and stays with the caller.
 */
export function useCollectionShortcutSupport(options: { readonly resolveOnMount?: boolean } = {}): CollectionShortcutSupport {
  const { resolveOnMount = false } = options;
  const directShareSupported = collectionShortcutService.isSupported();
  const [homePinSupport, setHomePinSupport] = useState<HomePinSupport>('unknown');
  const requestIdRef = useRef(0);

  const refreshHomePinSupport = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setHomePinSupport('unknown');
    let supported = false;
    try {
      supported = collectionShortcutService.isSupported() && (await collectionShortcutService.isHomeShortcutSupported());
    } catch {
      supported = false;
    }
    // A newer refresh (or an unmount) supersedes this answer.
    if (requestIdRef.current === requestId) {
      setHomePinSupport(supported ? 'supported' : 'unsupported');
    }
  }, []);

  useEffect(() => {
    if (resolveOnMount) {
      refreshHomePinSupport().catch(() => undefined);
    }
    return () => {
      requestIdRef.current += 1;
    };
  }, [refreshHomePinSupport, resolveOnMount]);

  return { directShareSupported, homePinSupport, refreshHomePinSupport };
}

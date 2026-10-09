import type { Collection } from '../collections/api/collectionsApi';
import { resolveCollectionColorTile, resolveEffectiveCollectionColorValue } from '../collections/collectionColors';
import { resolveCollectionIconKey } from '../collections/collectionIcons';
import NativeIncomingShare, { type PinnedCollectionShortcut } from '../share/specs/NativeIncomingShare';
import { getShortcutIneligibility, isShortcutEligible } from './collectionShortcutEligibility';

/**
 * The app's one abstraction over "Collections the user put on their device's shortcuts" - screens and sync code talk to
 * this, never to the Android ShortcutManager or the native bridge directly.
 *
 * Product rules it enforces:
 * - Device-local and explicit: the user asks for a Home-screen icon of a Collection (long-press > 홈 화면에 바로가기 추가,
 *   Android's own system dialog). Nothing is sent to the backend. The same Collection also becomes a Direct Share destination,
 *   but only when it is writable and NOT locked / behind an access password (a share-sheet label is visible outside Juple's
 *   protected UI, and nothing may be saved into content the user has not unlocked), and only once the launcher reports the
 *   icon was really accepted - a cancelled dialog changes nothing. A locked Collection may still get its Home icon (opening it
 *   still asks for the password). A Collection that stops being eligible is removed from the share targets by the next
 *   [applyKnownCollections] / [applyAuthoritativeCollections]. Android cannot remove a Home icon the user created, so none
 *   of this claims to.
 * - The platform's shortcut limit is respected by REFUSING the new share target ({status: 'limit'}) - never by silently
 *   evicting a Collection the user already chose.
 *
 * Android only today (NativeIncomingShare is null elsewhere, so [isSupported] is false and every call is a no-op). The
 * shape is platform-neutral on purpose: iOS Home Screen Quick Actions can implement the same operations later.
 *
 * Calls are serialized: every change reads the stored set and writes it back as a whole, so two quick taps never lose
 * one another's update.
 */

export type HomeShortcutOutcome =
  /** The launcher's dialog was shown. `shareable`: it also becomes a Direct Share destination if the user accepts it. */
  | { readonly status: 'requested'; readonly shareable: boolean; readonly lockedNotShared: boolean }
  /** The Collection would be a share target but the platform limit is reached: nothing was requested, nothing was evicted. */
  | { readonly status: 'limit'; readonly max: number }
  | { readonly status: 'unsupported' };

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function read(): Promise<readonly PinnedCollectionShortcut[]> {
  return NativeIncomingShare ? NativeIncomingShare.getPinnedCollectionShortcuts() : [];
}

/** A stored entry plus - only while it travels to native - the signed photo link the card is showing (never stored natively). */
type PinnedWrite = PinnedCollectionShortcut & { readonly imageUrl?: string | null };

async function write(pinned: readonly PinnedWrite[]): Promise<void> {
  if (NativeIncomingShare) {
    await NativeIncomingShare.setPinnedCollectionShortcuts(
      JSON.stringify(pinned.map(({ id, name, iconKey, tileColor, glyphColor, imageVersion, imageUrl }) => ({
        id,
        name,
        iconKey: iconKey ?? undefined,
        tileColor: tileColor ?? undefined,
        glyphColor: glyphColor ?? undefined,
        imageVersion: imageVersion ?? undefined,
        imageUrl: imageUrl ?? undefined,
      }))),
    );
  }
}

/**
 * What a Collection's shortcut icon is drawn from - read from the very fields its card in the app is drawn from, so there is no
 * second notion of how a Collection looks: its photo (iconImageUrl + iconImageVersion), else its configured icon (`icon`) on its
 * color (`color`, or the card's id-deterministic default tile), else - natively - the initial of its name.
 */
export function collectionVisual(collection: Collection): Required<Omit<PinnedWrite, 'id' | 'name'>> {
  const tile = resolveCollectionColorTile(resolveEffectiveCollectionColorValue(collection.color, collection.id));
  const hasPhoto = !!collection.iconImageUrl && !!collection.iconImageVersion;
  return {
    iconKey: resolveCollectionIconKey(collection.icon),
    tileColor: tile.background,
    glyphColor: tile.icon,
    imageVersion: hasPhoto ? collection.iconImageVersion! : null,
    imageUrl: hasPhoto ? collection.iconImageUrl! : null,
  };
}

function entryOf(collection: Collection): PinnedWrite {
  return { id: collection.id, name: collection.name, ...collectionVisual(collection) };
}

function sameSet(a: readonly PinnedCollectionShortcut[], b: readonly PinnedCollectionShortcut[]): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index];
    return entry.id === other.id
      && entry.name === other.name
      && (entry.iconKey ?? null) === (other.iconKey ?? null)
      && (entry.tileColor ?? null) === (other.tileColor ?? null)
      && (entry.glyphColor ?? null) === (other.glyphColor ?? null)
      && (entry.imageVersion ?? null) === (other.imageVersion ?? null);
  });
}

export const collectionShortcutService = {
  isSupported(): boolean {
    return NativeIncomingShare !== null;
  },

  getPinned(): Promise<readonly PinnedCollectionShortcut[]> {
    return serialized(read);
  },

  async getPinnedCollectionIds(): Promise<ReadonlySet<number>> {
    return new Set((await serialized(read)).map(entry => entry.id));
  },

  /** Whether this launcher can add Home-screen shortcuts at all. */
  async isHomeShortcutSupported(): Promise<boolean> {
    return NativeIncomingShare ? NativeIncomingShare.isHomeShortcutSupported() : false;
  },

  /**
   * Asks the launcher for a real 1x1 Home icon of the Collection. It does NOT mark the Collection as a share target - the
   * native side does that only when the launcher confirms the pin (see PinShortcutResultReceiver), so the stored state never
   * says more than what really happened. A locked Collection gets its icon but is never a share target.
   */
  requestHomeShortcut(collection: Collection): Promise<HomeShortcutOutcome> {
    return serialized(async (): Promise<HomeShortcutOutcome> => {
      if (!NativeIncomingShare || !(await NativeIncomingShare.isHomeShortcutSupported())) {
        return { status: 'unsupported' };
      }
      const shareable = isShortcutEligible(collection);
      if (shareable) {
        const pinned = await read();
        if (!pinned.some(entry => entry.id === collection.id)) {
          const max = await NativeIncomingShare.getMaxPinnedCollectionShortcuts();
          if (pinned.length >= max) {
            return { status: 'limit', max };
          }
        }
      }
      const visual = collectionVisual(collection);
      // The photo link is only handed over to be prepared (natively, once per photo version) - never kept or put in an Intent.
      const result = await NativeIncomingShare.requestHomeShortcut(
        collection.id,
        collection.name,
        visual.iconKey ?? '',
        visual.tileColor ?? '',
        visual.glyphColor ?? '',
        visual.imageUrl ?? '',
        visual.imageVersion ?? '',
        shareable,
      );
      return result === 'requested'
        ? { status: 'requested', shareable, lockedNotShared: getShortcutIneligibility(collection) === 'locked' }
        : { status: 'unsupported' };
    });
  },

  /** Removes it (a no-op when it is not pinned) - the user's choice, a deleted / left / revoked Collection, anything. */
  unpin(collectionId: number): Promise<void> {
    return serialized(async () => {
      const pinned = await read();
      if (pinned.some(entry => entry.id === collectionId)) {
        await write(pinned.filter(entry => entry.id !== collectionId));
      }
    });
  },

  /**
   * Brings the pinned set in line with Collections the app has ALREADY loaded (a list page, an opened Collection), no
   * request made: a renamed one gets its new label, one that is now locked / read-only is removed. A pinned Collection
   * that is not among them is left alone - this does not know it is gone.
   */
  applyKnownCollections(collections: readonly Collection[]): Promise<void> {
    return serialized(async () => {
      const pinned = await read();
      if (pinned.length === 0) {
        return;
      }
      const byId = new Map(collections.map(collection => [collection.id, collection]));
      const next = pinned.flatMap((entry): PinnedWrite[] => {
        const known = byId.get(entry.id);
        if (!known) {
          return [entry];
        }
        return isShortcutEligible(known) ? [entryOf(known)] : [];
      });
      if (!sameSet(pinned, next)) {
        await write(next);
      }
    });
  },

  /**
   * [applyKnownCollections] for a COMPLETE view of what the account can reach: a pinned Collection among `judgedIds` that is
   * missing from `collections` is gone (deleted, left, access revoked) and is removed. Only `judgedIds` are judged - a
   * Collection pinned while the view was being collected is not in it and must survive.
   */
  applyAuthoritativeCollections(collections: readonly Collection[], judgedIds: ReadonlySet<number>): Promise<void> {
    return serialized(async () => {
      const pinned = await read();
      if (pinned.length === 0) {
        return;
      }
      const byId = new Map(collections.map(collection => [collection.id, collection]));
      const next = pinned.flatMap((entry): PinnedWrite[] => {
        if (!judgedIds.has(entry.id)) {
          return [entry];
        }
        const known = byId.get(entry.id);
        return known && isShortcutEligible(known) ? [entryOf(known)] : [];
      });
      if (!sameSet(pinned, next)) {
        await write(next);
      }
    });
  },

  /** Sign-out / account change: every shortcut and the stored set go, so the next account never sees these names. */
  clear(): Promise<void> {
    return serialized(async () => {
      if (NativeIncomingShare) {
        await NativeIncomingShare.clearPinnedCollectionShortcuts();
      }
    });
  },
};

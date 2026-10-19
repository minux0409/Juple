import type { Collection } from '../collections/api/collectionsApi';
import { isCollectionLocked } from '../collections/collectionAccess';
import NativeCollectionShortcutsIOS from '../share/specs/NativeCollectionShortcutsIOS';

/** One Collection the Shortcuts app may offer in "컬렉션 열기": its id and name only. */
export interface IosShortcutChoice {
  readonly id: number;
  readonly name: string;
}

export type IosShortcutAddOutcome =
  | { readonly status: 'added' }
  | { readonly status: 'locked' }
  | { readonly status: 'limit'; readonly max: number }
  | { readonly status: 'unsupported' };

/** The native store refuses more than this (see CollectionShortcutStore.maxChoices). */
export const IOS_SHORTCUT_MAX_CHOICES = 50;

// One read-modify-write at a time, as in CollectionShortcutService.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<IosShortcutChoice[]> {
  if (!NativeCollectionShortcutsIOS) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(await NativeCollectionShortcutsIOS.getShortcutCollections());
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is IosShortcutChoice => typeof entry?.id === 'number' && typeof entry?.name === 'string')
      : [];
  } catch {
    return [];
  }
}

async function write(choices: readonly IosShortcutChoice[]): Promise<void> {
  if (NativeCollectionShortcutsIOS) {
    await NativeCollectionShortcutsIOS.setShortcutCollections(JSON.stringify(choices.map(({ id, name }) => ({ id, name }))));
  }
}

function same(a: readonly IosShortcutChoice[], b: readonly IosShortcutChoice[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.id === b[index].id && entry.name === b[index].name);
}

/** Only an unlocked Collection may be offered: its name is shown outside Juple (the Shortcuts app, and a shortcut's own label). */
function isOfferable(collection: Collection): boolean {
  return !isCollectionLocked(collection);
}

/**
 * The iOS counterpart of Android's Home-screen icon. iOS has no API for an app to add a Home-screen icon, so the person adds
 * the Collection here (it becomes selectable in the Shortcuts app's "컬렉션 열기" action) and then adds that shortcut to the
 * Home screen in the Shortcuts app. Running it opens Juple, which validates the Collection with the current account first
 * (CollectionShortcutRouter). Kept in line with the server like Android's pinned set; cleared on sign-out.
 */
export const iosCollectionShortcuts = {
  isSupported(): boolean {
    return NativeCollectionShortcutsIOS !== null;
  },

  getChoices(): Promise<readonly IosShortcutChoice[]> {
    return serialized(read);
  },

  add(collection: Collection): Promise<IosShortcutAddOutcome> {
    return serialized(async (): Promise<IosShortcutAddOutcome> => {
      if (!NativeCollectionShortcutsIOS) {
        return { status: 'unsupported' };
      }
      if (!isOfferable(collection)) {
        return { status: 'locked' };
      }
      const choices = await read();
      const existing = choices.findIndex(entry => entry.id === collection.id);
      if (existing === -1 && choices.length >= IOS_SHORTCUT_MAX_CHOICES) {
        return { status: 'limit', max: IOS_SHORTCUT_MAX_CHOICES };
      }
      const entry = { id: collection.id, name: collection.name };
      const next = existing === -1 ? [...choices, entry] : choices.map(choice => (choice.id === collection.id ? entry : choice));
      if (!same(choices, next)) {
        await write(next);
      }
      return { status: 'added' };
    });
  },

  remove(collectionId: number): Promise<void> {
    return serialized(async () => {
      const choices = await read();
      if (choices.some(entry => entry.id === collectionId)) {
        await write(choices.filter(entry => entry.id !== collectionId));
      }
    });
  },

  /** Collections the app has already loaded: a renamed one gets its new name, one that is now locked is removed. Nothing else is judged. */
  applyKnownCollections(collections: readonly Collection[]): Promise<void> {
    return serialized(async () => {
      const choices = await read();
      if (choices.length === 0) {
        return;
      }
      const byId = new Map(collections.map(collection => [collection.id, collection]));
      const next = choices.flatMap((entry): IosShortcutChoice[] => {
        const known = byId.get(entry.id);
        if (!known) {
          return [entry];
        }
        return isOfferable(known) ? [{ id: known.id, name: known.name }] : [];
      });
      if (!same(choices, next)) {
        await write(next);
      }
    });
  },

  /** applyKnownCollections for a COMPLETE view: a choice among `judgedIds` missing from `collections` is gone and is removed. */
  applyAuthoritativeCollections(collections: readonly Collection[], judgedIds: ReadonlySet<number>): Promise<void> {
    return serialized(async () => {
      const choices = await read();
      if (choices.length === 0) {
        return;
      }
      const byId = new Map(collections.map(collection => [collection.id, collection]));
      const next = choices.flatMap((entry): IosShortcutChoice[] => {
        const known = byId.get(entry.id);
        if (!known) {
          return judgedIds.has(entry.id) ? [] : [entry];
        }
        return isOfferable(known) ? [{ id: known.id, name: known.name }] : [];
      });
      if (!same(choices, next)) {
        await write(next);
      }
    });
  },

  /** On sign-out: every offered Collection and any pending launch. */
  clear(): Promise<void> {
    return serialized(async () => {
      if (NativeCollectionShortcutsIOS) {
        await NativeCollectionShortcutsIOS.clearShortcutCollections();
      }
    });
  },
};

import { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CategoryPickerModal } from '../CategoryPickerModal';
import { useCategoryPickerModal, type UseCategoryPickerModalResult } from '../useCategoryPickerModal';
import { getCollections, unlockCollection, type Collection } from '../api/collectionsApi';
import { clearCollectionUnlockGrants, rememberCollectionUnlock } from '../collectionUnlockGrants';

jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../../categories/collectionShortcutSync', () => ({ reconcileCollectionShortcuts: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  getCollections: jest.fn(),
  unlockCollection: jest.fn(),
}));

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: 1,
    name: 'C',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

const lockedA = makeCollection({ id: 1, name: 'A', isLocked: true });
const openB = makeCollection({ id: 2, name: 'B' });
const lockedC = makeCollection({ id: 3, name: 'C', isLocked: true });
const viewOnly = makeCollection({ id: 4, name: 'Viewer', accessRole: 'viewer' });
const contributed = makeCollection({ id: 5, name: 'Contributor', accessRole: 'contributor' });

let picker: UseCategoryPickerModalResult;
let selected: ReadonlySet<number>;

/** A screen like ItemDetails/NewLinkReview: its own selection, the shared picker hook and modal. */
function Harness({ initiallySelected = [] }: { readonly initiallySelected?: readonly number[] }) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set(initiallySelected));
  picker = useCategoryPickerModal(jest.fn() as never, i18n.t.bind(i18n));
  selected = selectedIds;
  return (
    <CategoryPickerModal
      bottomInset={0}
      collectionPool={picker.collectionPool}
      error={picker.error}
      isCreatingCollection={false}
      isLoadingMore={false}
      isLoadingOptions={picker.isLoadingOptions}
      onClose={picker.close}
      onLoadMore={picker.loadMore}
      onToggle={option =>
        picker.requestToggle(option, () =>
          setSelectedIds(previous => {
            const next = new Set(previous);
            if (next.has(option.id)) {
              next.delete(option.id);
            } else {
              next.add(option.id);
            }
            return next;
          }))
      }
      onUnlockCancel={picker.cancelUnlock}
      onUnlockGranted={picker.onUnlockGranted}
      selectedIds={selectedIds}
      unlockTarget={picker.unlockTarget}
      visible={picker.isVisible}
    />
  );
}

async function renderPicker(initiallySelected: readonly number[] = []) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness initiallySelected={initiallySelected} />);
  });
  await act(async () => {
    await picker.open();
  });
  return renderer;
}

async function tap(renderer: ReactTestRenderer.ReactTestRenderer, id: number) {
  await act(async () => {
    renderer.root.findByProps({ testID: `category-picker-option-${id}` }).props.onPress();
  });
}

async function enterPassword(renderer: ReactTestRenderer.ReactTestRenderer, password: string) {
  await act(async () => {
    renderer.root.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText(password);
  });
  await act(async () => {
    await renderer.root.findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
  });
}

const promptOpen = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'collection-unlock-dialog').length > 0;

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.mocked(getCollections).mockImplementation(async (_request, options = {}) =>
    options.scope === 'shared' ? { items: [viewOnly, contributed], nextCursor: null } : { items: [lockedA, openB, lockedC], nextCursor: null });
  jest.mocked(unlockCollection).mockImplementation(async (_request, collectionId, password) => {
    if (password !== 'right') {
      throw new ApiError('forbidden', 403, 'invalidCollectionPassword');
    }
    return { unlockToken: `grant-${collectionId}`, expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() };
  });
});

afterEach(() => {
  jest.clearAllMocks();
  clearCollectionUnlockGrants();
});

describe('Collection picker - locked Collections need their password (ItemDetails / NewLinkReview)', () => {
  it('selecting a locked Collection asks for the password and selects it only after a correct one', async () => {
    const renderer = await renderPicker();

    await tap(renderer, 1);
    expect(promptOpen(renderer)).toBe(true);
    expect(selected.has(1)).toBe(false);

    await enterPassword(renderer, 'right');
    expect(selected.has(1)).toBe(true);
    expect(promptOpen(renderer)).toBe(false);
    expect(picker.unlockTokenFor(1)).toBe('grant-1');
  });

  it('a wrong password selects nothing and keeps asking; cancel selects nothing', async () => {
    const renderer = await renderPicker();

    await tap(renderer, 1);
    await enterPassword(renderer, 'wrong');
    expect(selected.has(1)).toBe(false);
    expect(promptOpen(renderer)).toBe(true);
    expect(picker.unlockTokenFor(1)).toBeNull();

    await act(async () => {
      renderer.root.findByProps({ testID: 'collection-unlock-dialog-cancel' }).props.onPress();
    });
    expect(selected.has(1)).toBe(false);
    expect(promptOpen(renderer)).toBe(false);
  });

  it('deselecting an already-selected locked Collection also needs the password', async () => {
    const renderer = await renderPicker([1]);

    await tap(renderer, 1);
    expect(promptOpen(renderer)).toBe(true);
    expect(selected.has(1)).toBe(true);

    await enterPassword(renderer, 'right');
    expect(selected.has(1)).toBe(false);
    expect(picker.unlockTokenFor(1)).toBe('grant-1');
  });

  it("several Collections: each locked one is verified (the Owner's lock password) and gets its own grant; an unlocked one never asks", async () => {
    const renderer = await renderPicker();

    await tap(renderer, 1);
    // The typed password is never offered to be kept on the device.
    expect(renderer.root.findAll(node => node.props.testID === 'lock-remember-on-device')).toHaveLength(0);
    await enterPassword(renderer, 'right');
    await tap(renderer, 2);
    expect(promptOpen(renderer)).toBe(false);
    await tap(renderer, 3);
    expect(promptOpen(renderer)).toBe(true);
    await enterPassword(renderer, 'right');

    expect([...selected].sort()).toEqual([1, 2, 3]);
    expect(jest.mocked(unlockCollection).mock.calls.map(call => call[1])).toEqual([1, 3]);
    // Each Collection's save request goes with its own grant; an unlocked one with none.
    expect([picker.unlockTokenFor(1), picker.unlockTokenFor(2), picker.unlockTokenFor(3)]).toEqual(['grant-1', null, 'grant-3']);
  });

  it('within one picker session an unlocked Collection toggles freely; after closing it asks again', async () => {
    const renderer = await renderPicker();
    await tap(renderer, 1);
    await enterPassword(renderer, 'right');

    await tap(renderer, 1); // deselect
    await tap(renderer, 1); // select again
    expect(promptOpen(renderer)).toBe(false);
    expect(jest.mocked(unlockCollection)).toHaveBeenCalledTimes(1);

    await act(async () => {
      picker.close();
    });
    await act(async () => {
      await picker.open();
    });
    await tap(renderer, 1);
    expect(promptOpen(renderer)).toBe(true);
    // The grant for the change already made is still there for Save.
    expect(picker.unlockTokenFor(1)).toBe('grant-1');
  });

  it("never reuses a Collection visit's grant - the picker asks on its own", async () => {
    rememberCollectionUnlock(1, 'visit-grant', new Date(Date.now() + 10 * 60_000).toISOString());
    const renderer = await renderPicker();

    await tap(renderer, 1);
    expect(promptOpen(renderer)).toBe(true);
    expect(picker.unlockTokenFor(1)).toBeNull();
  });

  it('never offers a Collection shared view-only (a Viewer cannot add links); a Contributor one is offered', async () => {
    await renderPicker();

    expect(picker.collectionPool.map(collection => collection.id)).toEqual([1, 2, 3, 5]);
  });
});

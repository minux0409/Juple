import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import { CollectionUnlockPanel } from '../../collections/CollectionUnlockPanel';
import { getCollection } from '../../collections/api/collectionsApi';
import { getItemDetails } from '../api/itemsApi';
import { useItemCardOpen } from '../useItemCardOpen';
import { clearItemOpenGrant, takeItemOpenGrant, type ItemOpenContext } from '../itemOpenGrant';
import { clearCollectionUnlockGrants, getCollectionUnlockToken, rememberCollectionUnlock } from '../../collections/collectionUnlockGrants';

jest.mock('../../collections/api/collectionsApi', () => ({ getCollection: jest.fn(), getCollectionItems: jest.fn() }));
jest.mock('../api/itemsApi', () => ({ getItemDetails: jest.fn() }));

const navigate = jest.fn<void, [number, ItemOpenContext?]>();
const refresh = jest.fn();
const unlocked = { id: 4, accessRole: 'owner', isLocked: false, isSharePasswordProtected: false };
const locked = { ...unlocked, isLocked: true };
let cardOpen!: ReturnType<typeof useItemCardOpen>;
function Host() {
  cardOpen = useItemCardOpen(navigate, refresh);
  return cardOpen.dialog;
}
async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<Host />); });
  return tree;
}
const panels = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAllByType(CollectionUnlockPanel);
async function enterPassword(tree: ReactTestRenderer.ReactTestRenderer, grant: string) {
  const panel = tree.root.findByType(CollectionUnlockPanel);
  // The panel is given its own onGranted, so it never stores the grant in collectionUnlockGrants.
  expect(typeof panel.props.onGranted).toBe('function');
  await act(async () => {
    panel.props.onGranted(grant, new Date(Date.now() + 15 * 60_000).toISOString());
    panel.props.onUnlocked();
  });
}

beforeEach(() => {
  jest.mocked(getItemDetails).mockResolvedValue({ id: 11 } as never);
});
afterEach(() => { jest.clearAllMocks(); clearCollectionUnlockGrants(); clearItemOpenGrant(); });

describe('Home and Archive card opening - always in the card\'s Collection context', () => {
  it('lock removed elsewhere since the list loaded: no prompt; the contextual read (no grant) and the popup open', async () => {
    jest.mocked(getCollection).mockResolvedValue(unlocked as never);
    const tree = await render();
    await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
    expect(panels(tree)).toHaveLength(0);
    expect(getItemDetails).toHaveBeenCalledWith(expect.any(Function), 11, { collectionId: 4, unlockToken: null });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(11, { collectionId: 4, grantKey: null });
  });

  it('lock added elsewhere since the list loaded: the password is asked for before anything is read', async () => {
    jest.mocked(getCollection).mockResolvedValue(locked as never);
    const tree = await render();
    await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
    expect(panels(tree)).toHaveLength(1);
    expect(getItemDetails).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lock removed while the password dialog is open: it continues (contextual read), no unlock error', async () => {
    jest.mocked(getCollection).mockResolvedValueOnce(locked as never).mockResolvedValueOnce(unlocked as never);
    const tree = await render();
    await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
    const panel = tree.root.findByType(CollectionUnlockPanel);
    await act(async () => { expect(await panel.props.onStateChanged()).toBe(true); });
    expect(panels(tree)).toHaveLength(0);
    expect(getItemDetails).toHaveBeenCalledWith(expect.any(Function), 11, { collectionId: 4, unlockToken: null });
    expect(navigate).toHaveBeenCalledWith(11, { collectionId: 4, grantKey: null });
  });

  it('a card without a Collection context opens as before', async () => {
    await render();
    await act(async () => { await cardOpen.open({ id: 12, collectionId: null }); });
    expect(getCollection).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(12);
  });

  describe('every open of a locked link asks again - the password authorizes that one opening only', () => {
    it('password → the contextual read carries THIS opening\'s grant → the popup takes it once; the next tap asks AGAIN', async () => {
      jest.mocked(getCollection).mockResolvedValue(locked as never);
      const tree = await render();

      await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
      expect(panels(tree)).toHaveLength(1);
      await enterPassword(tree, 'grant-4');

      expect(getItemDetails).toHaveBeenCalledWith(expect.any(Function), 11, { collectionId: 4, unlockToken: 'grant-4' });
      expect(navigate).toHaveBeenCalledTimes(1);
      const [, openContext] = navigate.mock.calls[0];
      expect(openContext?.collectionId).toBe(4);
      // The grant is not in navigation state - only a one-time key - and the popup can take it exactly once.
      expect(JSON.stringify(openContext)).not.toContain('grant-4');
      expect(takeItemOpenGrant(openContext?.grantKey, 4)).toBe('grant-4');
      expect(takeItemOpenGrant(openContext?.grantKey, 4)).toBeNull();
      // Nothing kept that could open it next time.
      expect(getCollectionUnlockToken(4)).toBeNull();

      // Back from the popup, tap the same card again: the password is asked for again.
      await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
      expect(panels(tree)).toHaveLength(1);
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('never borrows a Collection Details visit grant to skip the prompt', async () => {
      jest.mocked(getCollection).mockResolvedValue(locked as never);
      rememberCollectionUnlock(4, 'visit-grant', new Date(Date.now() + 15 * 60_000).toISOString());
      const tree = await render();
      await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
      expect(panels(tree)).toHaveLength(1);
      expect(getItemDetails).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('a grant the server does not accept for THIS Collection (e.g. one for Collection A on B) opens nothing - it asks again', async () => {
      jest.mocked(getCollection).mockResolvedValue(locked as never);
      jest.mocked(getItemDetails).mockRejectedValueOnce(new ApiError('forbidden', 403, 'collectionLocked'));
      const tree = await render();
      await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
      await enterPassword(tree, 'grant-for-another-collection');
      expect(navigate).not.toHaveBeenCalled();
      expect(panels(tree)).toHaveLength(1);
    });

    it('a hand-off for one Collection is never taken for another', async () => {
      jest.mocked(getCollection).mockResolvedValue(locked as never);
      const tree = await render();
      await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
      await enterPassword(tree, 'grant-4');
      const [, openContext] = navigate.mock.calls[0];
      expect(takeItemOpenGrant(openContext?.grantKey, 5)).toBeNull();
    });

    it('cancelling the prompt opens nothing', async () => {
      jest.mocked(getCollection).mockResolvedValue(locked as never);
      const tree = await render();
      await act(async () => { await cardOpen.open({ id: 11, collectionId: 4 }); });
      const cancel = tree.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function').pop()!;
      await act(async () => { cancel.props.onPress(); });
      expect(panels(tree)).toHaveLength(0);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});

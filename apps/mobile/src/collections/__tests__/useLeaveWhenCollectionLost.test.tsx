import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import { publishBlockChange } from '../../safety/useBlockedUsers';
import { getCollection } from '../api/collectionsApi';
import { useLeaveWhenCollectionLost } from '../useLeaveWhenCollectionLost';

const mockNavigate = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('../api/collectionsApi', () => ({ getCollection: jest.fn() }));

function Harness({ id }: { readonly id: number }) {
  useLeaveWhenCollectionLost(id, () => mockNavigate('MainTabs'));
  return null;
}

const notFound = () => new ApiError('notFound', 404, 'gone');
async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness id={7} />);
  });
  return renderer;
}
const block = async (blocked = true) => act(async () => {
  publishBlockChange('ABCD2345', blocked);
});

afterEach(() => jest.clearAllMocks());

describe('useLeaveWhenCollectionLost', () => {
  it('leaves for the main tabs once the server says this Collection is gone after a block', async () => {
    jest.mocked(getCollection).mockRejectedValue(notFound());
    await mount();
    await block();
    expect(getCollection).toHaveBeenCalledWith(expect.anything(), 7);
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs');
  });

  it('stays when the Collection can still be opened (the blocked person was not its owner)', async () => {
    jest.mocked(getCollection).mockResolvedValue({ id: 7 } as never);
    await mount();
    await block();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('stays on an unclear answer (offline): the server refuses its writes anyway', async () => {
    jest.mocked(getCollection).mockRejectedValue(new Error('offline'));
    await mount();
    await block();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('an unblock asks nothing and moves nobody', async () => {
    await mount();
    await block(false);
    expect(getCollection).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('stops listening when the screen is gone', async () => {
    const renderer = await mount();
    await act(async () => renderer.unmount());
    await block();
    expect(getCollection).not.toHaveBeenCalled();
  });
});

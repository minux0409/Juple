import ReactTestRenderer, { act } from 'react-test-renderer';
import { useCollectionShortcutSupport, type CollectionShortcutSupport } from '../useCollectionShortcutSupport';

const mockIsSupported = jest.fn();
const mockIsHomeShortcutSupported = jest.fn();
jest.mock('../CollectionShortcutService', () => ({
  collectionShortcutService: {
    isSupported: () => mockIsSupported(),
    isHomeShortcutSupported: () => mockIsHomeShortcutSupported(),
  },
}));

let latest!: CollectionShortcutSupport;
function Probe({ resolveOnMount }: { resolveOnMount?: boolean }) {
  latest = useCollectionShortcutSupport({ resolveOnMount });
  return null;
}

async function mount(resolveOnMount: boolean) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Probe resolveOnMount={resolveOnMount} />);
  });
  return renderer;
}

beforeEach(() => {
  mockIsSupported.mockReset().mockReturnValue(true);
  mockIsHomeShortcutSupported.mockReset().mockResolvedValue(true);
});

describe('useCollectionShortcutSupport', () => {
  it('is unknown until the launcher has answered, then supported', async () => {
    let resolveLauncher!: (value: boolean) => void;
    mockIsHomeShortcutSupported.mockReturnValue(new Promise<boolean>(resolve => { resolveLauncher = resolve; }));
    const renderer = await mount(true);
    expect(latest.homePinSupport).toBe('unknown');
    expect(latest.directShareSupported).toBe(true);
    await act(async () => resolveLauncher(true));
    expect(latest.homePinSupport).toBe('supported');
    act(() => renderer.unmount());
  });

  it('does not ask the launcher until asked, when it is not resolving on mount', async () => {
    const renderer = await mount(false);
    expect(mockIsHomeShortcutSupported).not.toHaveBeenCalled();
    expect(latest.homePinSupport).toBe('unknown');
    await act(async () => latest.refreshHomePinSupport());
    expect(latest.homePinSupport).toBe('supported');
    act(() => renderer.unmount());
  });

  it('home pinning needs BOTH native support and a launcher that can pin', async () => {
    mockIsHomeShortcutSupported.mockResolvedValue(false);
    const renderer = await mount(true);
    expect(latest.directShareSupported).toBe(true);
    expect(latest.homePinSupport).toBe('unsupported');
    act(() => renderer.unmount());
  });

  it('without the native module nothing is supported and the launcher is never asked (no Platform.OS guess)', async () => {
    mockIsSupported.mockReturnValue(false);
    const renderer = await mount(true);
    expect(latest.directShareSupported).toBe(false);
    expect(latest.homePinSupport).toBe('unsupported');
    expect(mockIsHomeShortcutSupported).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('a rejected launcher call is unsupported', async () => {
    mockIsHomeShortcutSupported.mockRejectedValue(new Error('launcher'));
    const renderer = await mount(true);
    expect(latest.homePinSupport).toBe('unsupported');
    act(() => renderer.unmount());
  });

  it('re-queries the launcher on every refresh - nothing is cached', async () => {
    const renderer = await mount(true);
    expect(mockIsHomeShortcutSupported).toHaveBeenCalledTimes(1);
    mockIsHomeShortcutSupported.mockResolvedValue(false);
    await act(async () => latest.refreshHomePinSupport());
    expect(mockIsHomeShortcutSupported).toHaveBeenCalledTimes(2);
    expect(latest.homePinSupport).toBe('unsupported');
    act(() => renderer.unmount());
  });
});

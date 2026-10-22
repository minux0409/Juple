import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppModal } from '../../components/AppModal';
import { CollectionUnlockDialog } from '../CollectionUnlockDialog';
import { CollectionUnlockPanel } from '../CollectionUnlockPanel';
import { unlockCollection, type Collection } from '../api/collectionsApi';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  unlockCollection: jest.fn(),
}));

const locked: Collection = {
  id: 9,
  name: 'test',
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  isLocked: true,
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
const byId = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID && typeof node.type !== 'string')[0];
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

async function render(props: Partial<React.ComponentProps<typeof CollectionUnlockDialog>> = {}) {
  const onGranted = jest.fn();
  const onCancel = jest.fn();
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionUnlockDialog collection={locked} onCancel={onCancel} onGranted={onGranted} {...props} />);
  });
  return { renderer, onGranted, onCancel };
}

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => jest.clearAllMocks());

describe('CollectionUnlockDialog - one modal card', () => {
  it('puts the name, lock prompt, input, 잠금 해제 and 취소 inside a single AppModal', async () => {
    const { renderer } = await render();
    const modal = renderer.root.findByType(AppModal);
    expect(modal.props.title).toBe('test');
    expect(modal.findAllByType(CollectionUnlockPanel)).toHaveLength(1);
    // Cancel is the modal's own footer; the name is the title - neither is rendered outside the card.
    expect(modal.props.footer).toBeTruthy();
    const names = texts(renderer).filter(text => text === 'test');
    expect(names).toHaveLength(1);
    expect(byId(renderer, 'collection-unlock-password')).toBeDefined();
    expect(byId(renderer, 'collection-unlock-submit')).toBeDefined();
    expect(byId(renderer, 'collection-unlock-dialog-cancel')).toBeDefined();
    // The panel is not a card within the card.
    expect(renderer.root.findByType(CollectionUnlockPanel).props).toMatchObject({ embedded: true });
  });

  it('renders nothing while closed and mounts a fresh prompt on every opening', async () => {
    const { renderer, onCancel } = await render({ collection: null });
    expect(renderer.root.findAllByType(AppModal)).toHaveLength(0);

    await act(async () => {
      renderer.update(<CollectionUnlockDialog collection={locked} onCancel={onCancel} onGranted={jest.fn()} />);
    });
    await act(async () => {
      byId(renderer, 'collection-unlock-password').props.onChangeText('typed');
    });
    await act(async () => {
      renderer.update(<CollectionUnlockDialog collection={null} onCancel={onCancel} onGranted={jest.fn()} />);
    });
    await act(async () => {
      renderer.update(<CollectionUnlockDialog collection={locked} onCancel={onCancel} onGranted={jest.fn()} />);
    });
    expect(byId(renderer, 'collection-unlock-password').props.value).toBe('');
    expect(renderer.root.findAllByType(AppModal)).toHaveLength(1);
  });

  it('cancel (footer button and the modal close) calls onCancel and grants nothing', async () => {
    const { renderer, onCancel, onGranted } = await render();
    await act(async () => {
      byId(renderer, 'collection-unlock-dialog-cancel').props.onPress();
    });
    await act(async () => {
      byId(renderer, 'collection-unlock-dialog-close').props.onPress();
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onGranted).not.toHaveBeenCalled();
    expect(unlockCollection).not.toHaveBeenCalled();
  });

  it('a wrong password keeps the prompt open with the reason; the right one hands over the grant', async () => {
    const { renderer, onGranted } = await render();
    jest.mocked(unlockCollection).mockRejectedValueOnce(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    await act(async () => {
      byId(renderer, 'collection-unlock-password').props.onChangeText('wrong');
    });
    await act(async () => {
      await byId(renderer, 'collection-unlock-submit').props.onPress();
    });
    expect(texts(renderer)).toContain(i18n.t('collections.lockWrongPassword'));
    expect(onGranted).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(AppModal)).toHaveLength(1);

    jest.mocked(unlockCollection).mockResolvedValueOnce({ unlockToken: 'grant', expiresAtUtc: '2026-01-01T00:05:00Z' });
    await act(async () => {
      byId(renderer, 'collection-unlock-password').props.onChangeText('right');
    });
    await act(async () => {
      await byId(renderer, 'collection-unlock-submit').props.onPress();
    });
    expect(onGranted).toHaveBeenCalledWith('grant', '2026-01-01T00:05:00Z');
  });
});

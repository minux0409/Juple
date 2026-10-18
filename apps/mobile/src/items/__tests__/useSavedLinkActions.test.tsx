import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { useSavedLinkActions, type SavedLinkActionTarget } from '../useSavedLinkActions';
import { copySavedLinkUrl } from '../copyLink';

const mockToast = jest.fn();
jest.mock('../../components/AppToast', () => ({ useAppToast: () => ({ showNotificationToast: mockToast }) }));
jest.mock('../../collections/useItemCollectionChange', () => ({ useItemCollectionChange: () => ({ start: jest.fn(), element: null }) }));

const ORIGINAL_URL = 'https://shop.example.com/item?id=7&utm=abc';
const target = { id: 7, url: ORIGINAL_URL, isCollectionLocked: false } as unknown as SavedLinkActionTarget;

function Harness({ onActions }: { readonly onActions: (actions: ReturnType<typeof useSavedLinkActions>) => void }) {
  const actions = useSavedLinkActions({ onEdit: jest.fn(), onDelete: jest.fn(), onCollectionsChanged: jest.fn() });
  onActions(actions);
  return actions.element;
}

async function openMenu() {
  let hook!: ReturnType<typeof useSavedLinkActions>;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness onActions={value => { hook = value; }} />);
  });
  await act(async () => hook.menuProps(target).onLongPress!());
  return { renderer, labels: () => renderer.root.findByType(ActionMenuDialog).props.actions as { label: string; onPress: () => void }[] };
}

describe('saved link long-press menu: 링크 복사', () => {
  beforeEach(() => {
    mockToast.mockClear();
    jest.mocked(Clipboard.setString).mockClear();
  });

  it('offers 링크 복사 right after 링크 열기 and copies the ORIGINAL url (never a Juple share link), then says so', async () => {
    const { labels } = await openMenu();
    expect(labels().map(action => action.label)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('item.copyLink'), i18n.t('common.edit'), i18n.t('collections.changeCollection'), i18n.t('common.delete')]);
    await act(async () => labels()[1].onPress());
    expect(Clipboard.setString).toHaveBeenCalledWith(ORIGINAL_URL);
    expect(mockToast).toHaveBeenCalledWith(i18n.t('item.linkCopied'));
  });

  it('a clipboard that cannot be written is reported, not silently ignored', async () => {
    jest.mocked(Clipboard.setString).mockImplementationOnce(() => {
      throw new Error('denied');
    });
    const { labels } = await openMenu();
    await act(async () => labels()[1].onPress());
    expect(mockToast).toHaveBeenCalledWith(i18n.t('item.linkCopyFailed'));
  });

  it('copySavedLinkUrl reports success / failure', () => {
    expect(copySavedLinkUrl(ORIGINAL_URL)).toBe(true);
    jest.mocked(Clipboard.setString).mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(copySavedLinkUrl(ORIGINAL_URL)).toBe(false);
  });

  it('a locked (redacted) card has no menu at all, so nothing can be copied from it', async () => {
    let hook!: ReturnType<typeof useSavedLinkActions>;
    await act(async () => {
      ReactTestRenderer.create(<Harness onActions={value => { hook = value; }} />);
    });
    expect(hook.menuProps({ ...target, isCollectionLocked: true } as SavedLinkActionTarget).onLongPress).toBeUndefined();
  });
});

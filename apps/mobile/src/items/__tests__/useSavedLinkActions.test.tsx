import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { useSavedLinkActions, type SavedLinkActionTarget } from '../useSavedLinkActions';
import { copySavedLinkUrl } from '../copyLink';
import Clipboard from '@react-native-clipboard/clipboard';

const ORIGINAL_URL = 'https://shop.example.com/item?id=7&utm=abc';
const target = { id: 7, url: ORIGINAL_URL, isCollectionLocked: false } as unknown as SavedLinkActionTarget;

function Harness({ onActions, onLongPress }: { readonly onActions: (actions: ReturnType<typeof useSavedLinkActions>) => void; readonly onLongPress: (item: SavedLinkActionTarget) => void }) {
  const actions = useSavedLinkActions({ onLongPress });
  onActions(actions);
  return actions.element;
}

async function render(onLongPress: (item: SavedLinkActionTarget) => void = jest.fn()) {
  let hook!: ReturnType<typeof useSavedLinkActions>;
  await act(async () => {
    ReactTestRenderer.create(<Harness onActions={value => { hook = value; }} onLongPress={onLongPress} />);
  });
  return () => hook;
}

describe('saved link card wiring (long-press now starts multi-selection)', () => {
  it('a long-press hands the card to the selection - there is no centered menu any more', async () => {
    const onLongPress = jest.fn();
    const hook = await render(onLongPress);
    await act(async () => hook().menuProps(target).onLongPress!());
    expect(onLongPress).toHaveBeenCalledWith(target);
  });

  it('a locked (redacted) card can be neither selected nor opened from its card', async () => {
    const hook = await render();
    const locked = { ...target, isCollectionLocked: true } as SavedLinkActionTarget;
    expect(hook().menuProps(locked).onLongPress).toBeUndefined();
    expect(hook().originalLinkProps(locked).onOpenOriginal).toBeUndefined();
  });

  it('바로가기 opens the saved original page', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const hook = await render();
    await act(async () => hook().originalLinkProps(target).onOpenOriginal!());
    expect(openUrl).toHaveBeenCalledWith(ORIGINAL_URL);
    openUrl.mockRestore();
  });

  it('copySavedLinkUrl reports success / failure of the clipboard', () => {
    expect(copySavedLinkUrl(ORIGINAL_URL)).toBe(true);
    jest.mocked(Clipboard.setString).mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(copySavedLinkUrl(ORIGINAL_URL)).toBe(false);
  });
});

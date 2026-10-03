import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Modal, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { CONTACT_EMAIL } from '../../config/contactConfig';
import { ContactScreen } from '../ContactScreen';

jest.mock('@react-native-clipboard/clipboard', () => ({ __esModule: true, default: { setString: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ContactScreen />);
  });
  return renderer;
}
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => node.props.children);

describe('ContactScreen (문의하기)', () => {
  it('shows a short explanation, the support address and an 이메일 보내기 button - no form of its own', async () => {
    const renderer = await renderScreen();

    expect(CONTACT_EMAIL).toBe('jupleinfo@gmail.com');
    expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('contact.description'), 'jupleinfo@gmail.com', '이메일 보내기']));
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'contact-send' }).props.accessibilityRole).toBe('button');
  });

  it('이메일 보내기 opens the system mail app with a mailto: link and the localized subject', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'contact-send' }).props.onPress();
    });

    expect(openURL).toHaveBeenCalledWith(`mailto:jupleinfo@gmail.com?subject=${encodeURIComponent('Juple 문의')}`);
  });

  it('without a mail app, the common dialog says so with the address, and the address stays on screen and can be copied', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail client'));
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'contact-send' }).props.onPress();
    });

    const dialog = renderer.root.findAll(node => node.type === Modal && node.props.visible === true)[0];
    expect(dialog.findAllByType(Text).map(node => node.props.children)).toContain(i18n.t('contact.noMailApp', { email: 'jupleinfo@gmail.com' }));
    expect(texts(renderer)).toContain('jupleinfo@gmail.com');
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'contact-copy-email' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('jupleinfo@gmail.com');
  });
});

import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { CustomerCenterScreen } from '../CustomerCenterScreen';
import { FAQ_TOPICS } from '../../support/faqTopics';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getVersion: () => '9.8.7', getBuildNumber: () => '654', getSystemVersion: () => '14' },
}));
jest.mock('../../config/legalLinks', () => ({ legalLinks: { termsUrl: null, privacyUrl: null } }));

const legal = jest.requireMock('../../config/legalLinks').legalLinks as { termsUrl: string | null; privacyUrl: string | null };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  legal.termsUrl = null;
  legal.privacyUrl = null;
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CustomerCenterScreen />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

describe('CustomerCenterScreen', () => {
  it('is one compact page: tutorial replay, FAQ, 문의하기 and the app information', async () => {
    const renderer = await renderScreen();

    expect(i18n.t('customerCenter.title')).toBe('고객센터');
    expect(texts(renderer)).toEqual(expect.arrayContaining([
      i18n.t('customerCenter.replayTutorial'),
      i18n.t('customerCenter.faqHeading'),
      i18n.t('customerCenter.inquiryHeading'),
      i18n.t('inquiry.title'),
      i18n.t('customerCenter.appInfoHeading'),
      'Juple',
    ]));
    expect(FAQ_TOPICS).toHaveLength(6);
    expect(FAQ_TOPICS.every(topic => exists(renderer, `faq-${topic}`))).toBe(true);
  });

  it('opens the tutorial in replay mode', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      byId(renderer, 'customer-center-tutorial').props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Tutorial', { mode: 'replay' });
  });

  describe('FAQ', () => {
    it('expands inline, one at a time, and collapses again - exposing the expanded state', async () => {
      const renderer = await renderScreen();
      const state = (topic: string) => byId(renderer, `faq-${topic}`).props.accessibilityState;

      expect(FAQ_TOPICS.every(topic => state(topic).expanded === false)).toBe(true);
      expect(exists(renderer, 'faq-saveLinks-answer')).toBe(false);

      await act(async () => {
        byId(renderer, 'faq-saveLinks').props.onPress();
      });
      expect(state('saveLinks')).toEqual({ expanded: true });
      expect(texts(renderer)).toContain(i18n.t('customerCenter.faq.saveLinks.answer'));

      await act(async () => {
        byId(renderer, 'faq-locks').props.onPress();
      });
      expect(state('locks')).toEqual({ expanded: true });
      expect(state('saveLinks')).toEqual({ expanded: false });
      expect(exists(renderer, 'faq-saveLinks-answer')).toBe(false);

      await act(async () => {
        byId(renderer, 'faq-locks').props.onPress();
      });
      expect(state('locks')).toEqual({ expanded: false });
      // Inline, never a modal.
      expect(renderer.root.findAllByType(Modal).filter(modal => modal.props.visible)).toHaveLength(0);
    });

    it('has a question and an answer for every topic', () => {
      for (const topic of FAQ_TOPICS) {
        expect(i18n.exists(`customerCenter.faq.${topic}.question`)).toBe(true);
        expect(i18n.exists(`customerCenter.faq.${topic}.answer`)).toBe(true);
      }
    });
  });

  describe('문의하기', () => {
    it('opens the in-app inquiry screen - never the mail app', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      const renderer = await renderScreen();

      await act(async () => {
        byId(renderer, 'customer-center-contact').props.onPress();
      });

      expect(mockNavigate).toHaveBeenCalledWith('SupportInquiry');
      expect(openURL).not.toHaveBeenCalled();
    });

    it('shows no support email address anywhere on the page', async () => {
      const renderer = await renderScreen();
      expect(JSON.stringify(renderer.toJSON())).not.toMatch(/@|mailto/i);
    });
  });

  describe('이용약관 / 개인정보처리방침', () => {
    it('shows neither row while no real document URL is configured (none is invented)', async () => {
      const renderer = await renderScreen();
      expect(texts(renderer)).not.toContain(i18n.t('customerCenter.terms'));
      expect(texts(renderer)).not.toContain(i18n.t('customerCenter.privacy'));
      expect(texts(renderer)).not.toContain(i18n.t('customerCenter.serviceInfoHeading'));
    });

    it('with configured URLs the rows open exactly those', async () => {
      legal.termsUrl = 'https://example.test/terms';
      legal.privacyUrl = 'https://example.test/privacy';
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      const renderer = await renderScreen();

      expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('customerCenter.serviceInfoHeading'), '이용약관', '개인정보처리방침']));
      await act(async () => {
        byId(renderer, 'customer-center-terms').props.onPress();
      });
      await act(async () => {
        byId(renderer, 'customer-center-privacy').props.onPress();
      });
      expect(openURL.mock.calls.map(call => call[0])).toEqual(['https://example.test/terms', 'https://example.test/privacy']);
    });

    it('a link that will not open is said in the common dialog', async () => {
      legal.termsUrl = 'https://example.test/terms';
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
      const renderer = await renderScreen();
      await act(async () => {
        byId(renderer, 'customer-center-terms').props.onPress();
      });
      const dialog = renderer.root.findAll(node => node.type === Modal && node.props.visible === true)[0];
      expect(dialog.findAllByType(Text).map(node => String(node.props.children))).toContain(i18n.t('customerCenter.openLinkFailed'));
    });
  });

  it('shows the real version and build of the installed app', async () => {
    const renderer = await renderScreen();
    expect(renderer.root.find(node => node.props.testID === 'customer-center-version' && typeof node.type === 'string').props.children).toBe('버전 9.8.7 (빌드 654)');
  });

  it('needs no network: nothing but bundled content is rendered', async () => {
    const fetchSpy = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    await renderScreen();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('CustomerCenterScreen without a network', () => {
  it('renders completely and makes no request when every request would fail', async () => {
    const fetchSpy = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const renderer = await renderScreen();
      expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('customerCenter.faqHeading'), i18n.t('inquiry.title'), 'Juple']));
      expect(exists(renderer, 'customer-center-version')).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      act(() => renderer.unmount());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

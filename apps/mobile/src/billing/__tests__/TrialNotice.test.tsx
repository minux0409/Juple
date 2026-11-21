import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, Text } from 'react-native';
import i18n from '../../i18n';
import { useOptionalAuth } from '../../auth/AuthContext';
import { TrialNotice } from '../TrialNotice';
import { useSubscriptionEntryAvailable } from '../useSubscriptionEntry';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../auth/AuthContext', () => ({ useOptionalAuth: jest.fn() }));
jest.mock('../useSubscriptionEntry', () => ({ useSubscriptionEntryAvailable: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

async function mountNotice(daysLeft: number, storeAvailable: boolean, programEnabled = true) {
  jest.mocked(useOptionalAuth).mockReturnValue({
    entitlement: {
      programEnabled, status: 'trial', trialEndsAtUtc: new Date(Date.now() + daysLeft * 86_400_000).toISOString(),
    },
  } as ReturnType<typeof useOptionalAuth>);
  jest.mocked(useSubscriptionEntryAvailable).mockReturnValue(storeAvailable);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<TrialNotice />); });
  return renderer;
}

describe.each(['ios', 'android'] as const)('trial notice on %s', platform => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', platform);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-17T00:00:00Z'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([[8, true, true, false], [7, true, true, true], [7, false, true, false], [7, true, false, false]])(
    'with %i days left, store available %s and program enabled %s, shows the subscription button %s',
    async (daysLeft, storeAvailable, programEnabled, expectedButton) => {
      const renderer = await mountNotice(daysLeft, storeAvailable, programEnabled);
      const card = renderer.root.findAllByProps({ testID: 'trial-notice' });
      const button = renderer.root.findAll(node => node.props.testID === 'trial-notice-view' && typeof node.props.onPress === 'function')[0];
      expect(card.length > 0).toBe(programEnabled);
      expect(Boolean(button)).toBe(expectedButton);
      if (button) {
        await act(async () => button.props.onPress());
        expect(mockNavigate).toHaveBeenCalledWith('Subscription');
      }
      await act(async () => renderer.unmount());
    },
  );

  it.each(['ar', 'de', 'ja'])('renders %s policy text without truncating the body', async language => {
    const previous = i18n.language;
    try {
      await i18n.changeLanguage(language);
      const renderer = await mountNotice(10, true);
      const body = renderer.root.findAllByType(Text).find(node => String(node.props.children).includes('720'));
      expect(body).toBeDefined();
      expect(body!.props.numberOfLines).toBeUndefined();
      expect(String(body!.props.children)).not.toMatch(/\{\{date\}\}/);
      await act(async () => renderer.unmount());
    } finally {
      await i18n.changeLanguage(previous);
    }
  });
});

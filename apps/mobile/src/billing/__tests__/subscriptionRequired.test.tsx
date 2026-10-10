import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { navigationRef } from '../../navigation/navigationRef';
import { SubscriptionExpiredNotice } from '../SubscriptionExpiredNotice';
import { SubscriptionRequiredPrompt } from '../SubscriptionRequiredPrompt';
import { notifySubscriptionRequired, subscribeSubscriptionRequired } from '../subscriptionRequired';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { isReady: jest.fn(), navigate: jest.fn() } }));
let mockEntitlement: { programEnabled: boolean; status: string | null } | null = null;
let mockHasProvider = true;
jest.mock('../../auth/AuthContext', () => ({
  useOptionalAuth: () => (mockHasProvider ? { entitlement: mockEntitlement } : undefined),
}));

const nav = navigationRef as unknown as { isReady: jest.Mock; navigate: jest.Mock };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEntitlement = null;
  mockHasProvider = true;
  nav.isReady.mockReturnValue(true);
});

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}
const dialog = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(ConfirmDialog);

describe('subscriptionRequired signal', () => {
  it('reaches every subscriber until it unsubscribes, and is harmless with none', () => {
    const first = jest.fn();
    const unsubscribe = subscribeSubscriptionRequired(first);
    notifySubscriptionRequired();
    unsubscribe();
    notifySubscriptionRequired();
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionRequiredPrompt', () => {
  it('stays hidden until a write is refused, then explains calmly and keeps reading available', () => {
    const renderer = render(<SubscriptionRequiredPrompt />);
    expect(dialog(renderer).props.visible).toBe(false);

    act(() => notifySubscriptionRequired());

    expect(dialog(renderer).props.visible).toBe(true);
    expect(dialog(renderer).props.title).toBe('구독이 필요해요');
    expect(dialog(renderer).props.message).toBe('저장하거나 수정하려면 구독이 필요해요. 저장한 링크와 컬렉션은 그대로 볼 수 있어요.');
    expect(dialog(renderer).props.confirmLabel).toBe('구독하기');
    expect(dialog(renderer).props.cancelLabel).toBe('나중에');
    expect(dialog(renderer).props.destructive).toBe(false);
  });

  it('나중에 just closes; repeated refusals while open change nothing', () => {
    const renderer = render(<SubscriptionRequiredPrompt />);
    act(() => {
      notifySubscriptionRequired();
      notifySubscriptionRequired();
    });
    expect(renderer.root.findAllByType(ConfirmDialog)).toHaveLength(1);

    act(() => dialog(renderer).props.onCancel());

    expect(dialog(renderer).props.visible).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('구독하기 opens the subscription screen', () => {
    const renderer = render(<SubscriptionRequiredPrompt />);
    act(() => notifySubscriptionRequired());

    act(() => dialog(renderer).props.onConfirm());

    expect(nav.navigate).toHaveBeenCalledWith('Subscription');
    expect(dialog(renderer).props.visible).toBe(false);
  });
});

describe('SubscriptionExpiredNotice', () => {
  const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
  const shown = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === 'subscription-expired-notice').length > 0;

  it('shows for an expired account once the program is launched: the reason, the reassurance and 구독하기', () => {
    mockEntitlement = { programEnabled: true, status: 'expired' };
    const renderer = render(<SubscriptionExpiredNotice />);

    expect(shown(renderer)).toBe(true);
    expect(texts(renderer)).toEqual(expect.arrayContaining([
      i18n.t('subscription.access.expired'),
      '구독하면 다시 저장하고 수정할 수 있어요. 저장한 링크는 그대로 보관되며 계속 볼 수 있어요.',
      '구독하기',
    ]));
    act(() => renderer.root.find(node => node.props.testID === 'subscription-expired-notice-cta' && typeof node.props.onPress === 'function').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Subscription');
  });

  it.each(['trial', 'active', 'gracePeriod'])('is not shown while access is live (%s)', status => {
    mockEntitlement = { programEnabled: true, status };
    expect(shown(render(<SubscriptionExpiredNotice />))).toBe(false);
  });

  it('is never shown while the program is not launched (no status), whatever else is true', () => {
    mockEntitlement = { programEnabled: false, status: 'expired' };
    expect(shown(render(<SubscriptionExpiredNotice />))).toBe(false);
    mockEntitlement = { programEnabled: false, status: null };
    expect(shown(render(<SubscriptionExpiredNotice />))).toBe(false);
  });

  it('renders nothing before bootstrap or outside an auth provider', () => {
    mockEntitlement = null;
    expect(shown(render(<SubscriptionExpiredNotice />))).toBe(false);
    mockHasProvider = false;
    expect(shown(render(<SubscriptionExpiredNotice />))).toBe(false);
  });
});

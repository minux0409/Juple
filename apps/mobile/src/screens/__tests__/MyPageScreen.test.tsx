import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Switch, Text } from 'react-native';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';
import { deleteAccount } from '../../api/accountApi';
import { ScreenTitle } from '../../components/ScreenTitle';
import { screenIcons } from '../../navigation/screenIcons';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../api/accountApi', () => ({
  deleteAccount: jest.fn(),
}));

jest.mock('../../settings/quickSaveOnSharePreference', () => ({
  loadQuickSaveOnSharePreference: jest.fn().mockResolvedValue(false),
  saveQuickSaveOnSharePreference: jest.fn().mockResolvedValue(undefined),
}));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

function mockUseAuth(overrides: {
  signOut?: jest.Mock;
  userEmail?: string | null;
  plan?: 'Free' | 'Plus' | null;
}) {
  jest.mocked(useAuth).mockReturnValue({
    signOut: overrides.signOut ?? jest.fn(),
    userEmail: overrides.userEmail ?? null,
    plan: 'plan' in overrides ? overrides.plan ?? null : 'Free',
    entitlement: null,
    storeSubscription: null,
    refreshEntitlement: jest.fn(),
    isInitializing: false,
    isSigningIn: false,
    isAuthenticated: true,
    error: null,
    backendAuthStatus: 'valid',
    userBootstrapStatus: 'ready',
    sessionRestoreStep: 'sessionRestore',
    signIn: jest.fn(),
    getValidAccessToken: jest.fn(),
    retryBootstrap: jest.fn(),
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MyPageScreen />);
  });
  return renderer;
}

function findTextValues(renderer: ReactTestRenderer.ReactTestRenderer): unknown[] {
  return renderer.root.findAllByType(Text).map(node => node.props.children);
}

/**
 * MyPageScreen renders one ConfirmDialog (sign-out), a Modal always present in the tree with its
 * own `visible` prop - only the currently-open one is queried.
 */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const openDialog = renderer.root.findAll(node => node.type === Modal && node.props.visible === true)[0];
  return openDialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

function isInsideModal(node: ReactTestRenderer.ReactTestInstance): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === Modal) {
      return true;
    }
  }
  return false;
}

/** A settings row (outside any Modal) by the label text it contains. */
function findSettingsRow(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root
    .findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        node.findAll(inner => inner.props.children === label).length > 0,
    )
    .find(node => !isInsideModal(node));
}

describe('MyPageScreen settings entry points', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('navigates to Trash when the settings row is tapped', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    await act(async () => {
      findSettingsRow(renderer, i18n.t('settings.trash'))!.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('Trash');
  });

  it('has no 설정 heading - the rows (language, Quick Save, friends, lock, trash, account, customer center, logout) are not all settings', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    expect(findTextValues(renderer)).not.toContain('설정');
    // The profile card is followed directly by the one card of rows (no generic section heading in between).
    const labels = [
      i18n.t('settings.language'),
      i18n.t('settings.quickSaveOnShare'),
      i18n.t('friends.title'),
      i18n.t('settings.collectionLock'),
      i18n.t('settings.trash'),
      i18n.t('account.title'),
      i18n.t('customerCenter.title'),
      i18n.t('auth.logout'),
    ];
    const shown = findTextValues(renderer);
    const positions = labels.map(label => shown.indexOf(label));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('calls 공유 즉시 저장 by its new name 빠른 저장 (never 자동 저장), described as sharing into Juple', async () => {
    await i18n.changeLanguage('ko');
    try {
      mockUseAuth({ userEmail: null });
      const renderer = await renderScreen();

      expect(i18n.t('settings.quickSaveOnShare')).toBe('빠른 저장');
      expect(findTextValues(renderer)).toContain('빠른 저장');
      expect(findTextValues(renderer)).toContain('공유한 링크를 Juple에서 확인하고 컬렉션을 고른 뒤 저장합니다.');
      expect(i18n.t('settings.quickSaveOnShareOnDescription')).toBe('다른 앱에서 Juple로 공유한 링크를 검토 화면 없이 바로 저장합니다.');
      const everyKoreanValue = JSON.stringify(require('../../i18n/locales/ko.json'));
      expect(everyKoreanValue).not.toContain('공유 즉시 저장');
      expect(everyKoreanValue).not.toContain('자동 저장');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('빠른 저장 renders OFF when nothing is stored - and never shows a fake ON while the stored choice loads', async () => {
    const { loadQuickSaveOnSharePreference } = jest.requireMock('../../settings/quickSaveOnSharePreference');
    let resolveLoad!: (value: boolean) => void;
    loadQuickSaveOnSharePreference.mockReturnValueOnce(new Promise<boolean>(resolve => { resolveLoad = resolve; }));
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();
    const quickSaveSwitch = () => renderer.root.findByType(Switch);

    // Still loading: OFF and not touchable.
    expect(quickSaveSwitch().props.value).toBe(false);
    expect(quickSaveSwitch().props.disabled).toBe(true);

    await act(async () => resolveLoad(false));
    expect(quickSaveSwitch().props.value).toBe(false);
    expect(quickSaveSwitch().props.disabled).toBe(false);
    expect(findTextValues(renderer)).toContain(i18n.t('settings.quickSaveOnShareOffDescription'));
  });

  it('빠른 저장 renders ON for a stored true', async () => {
    const { loadQuickSaveOnSharePreference } = jest.requireMock('../../settings/quickSaveOnSharePreference');
    loadQuickSaveOnSharePreference.mockResolvedValueOnce(true);
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    expect(renderer.root.findByType(Switch).props.value).toBe(true);
    expect(findTextValues(renderer)).toContain(i18n.t('settings.quickSaveOnShareOnDescription'));
  });

  it('has a 도움말 row that opens the Help Guide, next to 고객센터', async () => {
    await i18n.changeLanguage('ko');
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    const row = renderer.root.findByProps({ testID: 'my-help-guide' });
    expect(row.findAllByType(Text).map(node => node.props.children)).toContain('도움말');
    await act(async () => {
      row.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('HelpGuide');
    expect(renderer.root.findAllByProps({ testID: 'my-customer-center' }).length).toBeGreaterThan(0);
  });

  it('has one 고객센터 row that opens the Customer Center - and no separate FAQ / 문의하기 / 튜토리얼 rows', async () => {
    await i18n.changeLanguage('ko');
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    const row = renderer.root.findByProps({ testID: 'my-customer-center' });
    expect(i18n.t('customerCenter.title')).toBe('고객센터');
    expect(row.findAllByType(Text).map(node => node.props.children)).toContain('고객센터');
    await act(async () => {
      row.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CustomerCenter');
    const labels = renderer.root.findAllByType(Text).map(node => String(node.props.children));
    for (const absent of [i18n.t('inquiry.title')]) {
      expect(labels).not.toContain(absent);
    }
    expect(renderer.root.findAll(node => node.props.testID === 'my-contact')).toHaveLength(0);
    await i18n.changeLanguage('en');
  });

  it('shows the same icons as the matching tab / screen titles (one icon per navigation item)', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    const iconTypes = (testID: string) => renderer.root.findByProps({ testID }).findAll(node => node.type === screenIcons.friends || node.type === screenIcons.collectionLock || node.type === screenIcons.account || node.type === screenIcons.customerCenter).map(node => node.type);
    expect(iconTypes('my-friends')).toContain(screenIcons.friends);
    expect(iconTypes('my-collection-lock')).toContain(screenIcons.collectionLock);
    expect(iconTypes('my-account-management')).toContain(screenIcons.account);
    expect(iconTypes('my-customer-center')).toContain(screenIcons.customerCenter);
    expect(renderer.root.findAllByType(ScreenTitle)[0].props.icon).toBe(screenIcons.myPage);
  });

  it('has a 계정 관리 row that opens Account Management', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    const row = renderer.root.findByProps({ testID: 'my-account-management' });
    expect(row.findAllByType(Text).map(node => node.props.children)).toContain(i18n.t('account.title'));
    await act(async () => {
      row.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('AccountManagement');
  });

  it('has no developer re-authentication test entry (removed after the DEV measurement)', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    expect(renderer.root.findAll(node => node.props.testID === 'my-reauth-diagnostics')).toHaveLength(0);
    expect(
      renderer.root.findAll(node => typeof node.props.children === 'string' && /재인증|auth_time|DEV\)/.test(node.props.children)),
    ).toHaveLength(0);
  });
});

describe('MyPageScreen sign-out', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('gates the actual sign-out behind the shared ConfirmDialog', async () => {
    const signOut = jest.fn();
    mockUseAuth({ signOut, userEmail: null });

    const renderer = await renderScreen();

    const signOutRow = findSettingsRow(renderer, i18n.t('auth.logout'));
    expect(signOutRow).toBeDefined();

    await act(async () => {
      signOutRow!.props.onPress();
    });

    expect(signOut).not.toHaveBeenCalled();

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('auth.logout')).props.onPress();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not sign out when the ConfirmDialog is cancelled', async () => {
    const signOut = jest.fn();
    mockUseAuth({ signOut, userEmail: null });
    const renderer = await renderScreen();

    await act(async () => {
      findSettingsRow(renderer, i18n.t('auth.logout'))!.props.onPress();
    });

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('common.cancel')).props.onPress();
    });

    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('MyPageScreen has no plan tiers', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders identical content regardless of the legacy plan value, with no Plus upsell', async () => {
    const renderedTextByPlan = [];
    for (const plan of ['Free', 'Plus', null] as const) {
      mockUseAuth({ userEmail: null, plan });
      const renderer = await renderScreen();
      renderedTextByPlan.push(findTextValues(renderer));
    }

    expect(renderedTextByPlan[1]).toEqual(renderedTextByPlan[0]);
    expect(renderedTextByPlan[2]).toEqual(renderedTextByPlan[0]);
    expect(JSON.stringify(renderedTextByPlan[0])).not.toMatch(/plus/i);
  });
});

describe('MyPageScreen account deletion is not on My Page', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows no delete-account action at the top level - it lives under 계정 관리', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    expect(findTextValues(renderer)).not.toContain(i18n.t('account.deleteAction'));
    expect(findTextValues(renderer)).not.toContain(i18n.t('deleteAccount.deleteNow'));
    for (const node of renderer.root.findAll(candidate => typeof candidate.props.onPress === 'function')) {
      await act(async () => {
        node.props.onPress();
      });
    }
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});

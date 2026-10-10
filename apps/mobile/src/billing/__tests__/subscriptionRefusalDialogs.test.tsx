import { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Pressable, Text } from 'react-native';
import i18n from '../../i18n';
import { requestApi } from '../../api/apiClient';
import { ApiError } from '../../api/ApiError';
import { getCollectionMembershipErrorMessage } from '../../collections/itemMemberships';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useMessageDialog } from '../../components/useMessageDialog';
import { SubscriptionRequiredPrompt } from '../SubscriptionRequiredPrompt';
import { isHandledSubscriptionRefusal, unlessRefusalHandled } from '../subscriptionRequired';

jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn() } }));
const { navigationRef } = jest.requireMock('../../navigation/navigationRef') as { navigationRef: { navigate: jest.Mock } };

/**
 * A stand-in for any screen, written the way the real ones are: ask the server, and on failure show whatever the screen's own error
 * mapper says through the shared dialog. Nothing here knows about subscriptions - the handled semantics live in the mapper helper.
 */
function Screen() {
  const { t } = i18n;
  const { showMessage, messageDialog } = useMessageDialog();
  const [, setCount] = useState(0);
  return (
    <>
      <Pressable
        onPress={() => {
          requestApi({ method: 'POST', path: '/x', accessToken: 't' })
            .catch(error => showMessage(getCollectionMembershipErrorMessage(error, t)))
            .finally(() => setCount(count => count + 1));
        }}
        testID="go"
      />
      <Pressable onPress={() => showMessage('다른 알림입니다.')} testID="unrelated" />
      {messageDialog}
    </>
  );
}

const originalFetch = globalThis.fetch;
function respondWith(status: number, body?: unknown) {
  globalThis.fetch = jest.fn().mockResolvedValue({ status, json: async () => body } as Response) as unknown as typeof fetch;
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID = 'go') {
  await act(async () => {
    renderer.root.findAll(node => node.props?.testID === testID && typeof node.props.onPress === 'function')[0].props.onPress();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** The dialogs a person can actually SEE: an open Modal, with its text. */
function openDialogs(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Modal)
    .filter(modal => modal.props.visible === true)
    .map(modal => modal.findAllByType(Text).map(node => String(node.props.children)).join(' | '));
}

function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <>
        <Screen />
        <SubscriptionRequiredPrompt />
      </>,
    );
  });
  return renderer;
}

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('a refused write shows exactly one dialog', () => {
  it('403 subscriptionRequired: only the subscription prompt - the screen\'s own message is not shown', async () => {
    respondWith(403, { code: 'subscriptionRequired' });
    const renderer = mount();

    await press(renderer);

    const dialogs = openDialogs(renderer);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('구독이 필요해요');
  });

  it('403 collectionOwnerSubscriptionRequired: only the owner notice (no subscribe button, nothing to buy)', async () => {
    respondWith(403, { code: 'collectionOwnerSubscriptionRequired' });
    const renderer = mount();

    await press(renderer);

    const dialogs = openDialogs(renderer);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('지금은 변경할 수 없어요');
    expect(dialogs[0]).not.toContain('구독하기');
  });

  it('the owner notice only closes - it never opens the subscription screen', async () => {
    respondWith(403, { code: 'collectionOwnerSubscriptionRequired' });
    const renderer = mount();
    await press(renderer);

    const notice = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '지금은 변경할 수 없어요')!;
    expect(notice.props.onCancel).toBeUndefined();
    act(() => notice.props.onConfirm());

    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(openDialogs(renderer)).toHaveLength(0);
  });

  it('구독하기 on the actor prompt opens the subscription screen', async () => {
    respondWith(403, { code: 'subscriptionRequired' });
    const renderer = mount();
    await press(renderer);

    act(() => renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '구독이 필요해요')!.props.onConfirm());

    expect(navigationRef.navigate).toHaveBeenCalledWith('Subscription');
  });

  it.each([
    ['a different 403', 403, { code: 'collectionLocked' }],
    ['a 404', 404, { code: 'notFound' }],
    ['a 409', 409, { code: 'linkAlreadyInCollection' }],
    ['a 500', 500, undefined],
  ])('%s: the screen\'s own message still opens, exactly as before', async (_name, status, body) => {
    respondWith(status, body);
    const renderer = mount();

    await press(renderer);

    const dialogs = openDialogs(renderer);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).not.toContain('구독이 필요해요');
    expect(dialogs[0].length).toBeGreaterThan(0);
  });

  it('a network failure still shows the screen\'s own message', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;
    const renderer = mount();

    await press(renderer);

    expect(openDialogs(renderer)).toHaveLength(1);
    expect(openDialogs(renderer)[0]).not.toContain('구독이 필요해요');
  });

  it('an unrelated normal notice right after the subscription dialog opens normally - nothing is swallowed by time', async () => {
    respondWith(403, { code: 'subscriptionRequired' });
    const renderer = mount();
    await press(renderer);
    act(() => renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '구독이 필요해요')!.props.onCancel());

    await press(renderer, 'unrelated');

    expect(openDialogs(renderer)).toEqual([expect.stringContaining('다른 알림입니다.')]);
  });

  it('even while the subscription dialog is still open, an unrelated notice is not hidden', async () => {
    respondWith(403, { code: 'subscriptionRequired' });
    const renderer = mount();
    await press(renderer);

    await press(renderer, 'unrelated');

    const dialogs = openDialogs(renderer);
    expect(dialogs).toHaveLength(2);
    expect(dialogs.some(text => text.includes('다른 알림입니다.'))).toBe(true);
  });
});

describe('the handled semantics', () => {
  it('recognises exactly the two refusal codes on a forbidden ApiError', () => {
    expect(isHandledSubscriptionRefusal(new ApiError('forbidden', 403, 'subscriptionRequired'))).toBe(true);
    expect(isHandledSubscriptionRefusal(new ApiError('forbidden', 403, 'collectionOwnerSubscriptionRequired'))).toBe(true);
    expect(isHandledSubscriptionRefusal(new ApiError('forbidden', 403, 'collectionLocked'))).toBe(false);
    expect(isHandledSubscriptionRefusal(new ApiError('forbidden', 403))).toBe(false);
    expect(isHandledSubscriptionRefusal(new ApiError('conflict', 409, 'subscriptionRequired'))).toBe(false);
    expect(isHandledSubscriptionRefusal(new Error('boom'))).toBe(false);
    expect(isHandledSubscriptionRefusal(undefined)).toBe(false);
  });

  it('unlessRefusalHandled reports every other error and stays silent for a handled refusal', () => {
    const report = jest.fn();
    unlessRefusalHandled(new ApiError('forbidden', 403, 'subscriptionRequired'), report);
    expect(report).not.toHaveBeenCalled();
    unlessRefusalHandled(new ApiError('unavailable', 500), report);
    unlessRefusalHandled(new TypeError('Network request failed'), report);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('an empty single-button notice is answered as dismissed; a message or a two-button confirmation is untouched', () => {
    const visibleOf = (props: Partial<React.ComponentProps<typeof ConfirmDialog>>) => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        renderer = ReactTestRenderer.create(<ConfirmDialog confirmLabel="확인" message="m" onConfirm={jest.fn()} title="t" visible {...props} />);
      });
      return renderer.root.findByType(Modal).props.visible as boolean;
    };

    const onConfirm = jest.fn();
    act(() => {
      ReactTestRenderer.create(<ConfirmDialog confirmLabel="확인" message="" onConfirm={onConfirm} title="t" visible />);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(visibleOf({ message: '' })).toBe(false);
    expect(visibleOf({})).toBe(true);
    expect(visibleOf({ message: '', cancelLabel: '취소', onCancel: jest.fn() })).toBe(true);
  });
});

import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Platform, Text } from 'react-native';
import { PendingActionRow } from '../../components/PendingActionRow';
import i18n from '../../i18n';
import { CollectionReviewRequestsSheet } from '../CollectionReviewRequestsSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));

const originalPlatform = Platform.OS;

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => {
  Platform.OS = originalPlatform;
});

function render(approvalCount: number, joinCount: number) {
  const onClose = jest.fn();
  const onOpenApprovals = jest.fn();
  const onOpenJoinRequests = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <CollectionReviewRequestsSheet
        approvalCount={approvalCount}
        joinCount={joinCount}
        onClose={onClose}
        onOpenApprovals={onOpenApprovals}
        onOpenJoinRequests={onOpenJoinRequests}
        visible
      />,
    );
  });
  return { renderer, onClose, onOpenApprovals, onOpenJoinRequests };
}

it('shows each positive queue count and opens only the selected queue on Android', () => {
  Platform.OS = 'android';
  const { renderer, onClose, onOpenApprovals, onOpenJoinRequests } = render(12, 2);
  const rows = renderer.root.findAllByType(PendingActionRow);
  expect(rows.map(row => row.findAllByType(Text).map(text => text.props.children))).toEqual([
    ['받은 승인 요청', '대기 12건'], ['참여 요청', '대기 2건'],
  ]);
  act(() => rows[1].props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onOpenJoinRequests).toHaveBeenCalledTimes(1);
  expect(onOpenApprovals).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it('waits for iOS modal dismissal before opening the selected queue and ignores empty types', () => {
  Platform.OS = 'ios';
  const { renderer, onClose, onOpenApprovals, onOpenJoinRequests } = render(2, 0);
  const row = renderer.root.findByType(PendingActionRow);
  expect(row.props.testID).toBe('collection-review-approvals');
  const modal = renderer.root.findByType(Modal);
  act(() => modal.props.onRequestClose());
  const backdrop = renderer.root.findAll(node => node.props.importantForAccessibility === 'no-hide-descendants' && typeof node.props.onPress === 'function')[0];
  const close = renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('common.close') && typeof node.props.onPress === 'function')[0];
  act(() => backdrop.props.onPress());
  act(() => close.props.onPress());
  act(() => modal.props.onDismiss());
  expect(onOpenApprovals).not.toHaveBeenCalled();
  act(() => row.props.onPress());
  expect(onClose).toHaveBeenCalledTimes(4);
  expect(onOpenApprovals).not.toHaveBeenCalled();
  act(() => modal.props.onDismiss());
  act(() => modal.props.onDismiss());
  expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  expect(onOpenJoinRequests).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

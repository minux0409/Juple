import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform } from 'react-native';
import { AppNativeModal, useNoticeModalBlocked } from '../AppNativeModal';

let blocked = false;
function Probe() { blocked = useNoticeModalBlocked(); return null; }
const originalOS = Platform.OS;
afterEach(() => { Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }); });

it.each(['android', 'ios'])('%s: waits behind an existing modal and leaves its callbacks and visibility intact', os => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  const dismissed = jest.fn();
  const element = (visible: boolean) => <><Probe /><AppNativeModal visible={visible} onDismiss={dismissed} /></>;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(element(true)); });
  expect(blocked).toBe(true);
  act(() => tree.update(element(false)));
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(blocked).toBe(os === 'ios');
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(blocked).toBe(false);
  expect(dismissed).toHaveBeenCalledTimes(1);
});

it('a late iOS dismissal callback cannot unblock a modal that has reopened', () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  const element = (visible: boolean) => <><Probe /><AppNativeModal visible={visible} /></>;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(element(true)); });
  const oldDismiss = tree.root.findByType(Modal).props.onDismiss;
  act(() => tree.update(element(false)));
  act(() => tree.update(element(true)));
  act(() => oldDismiss());
  expect(blocked).toBe(true);
  act(() => tree.update(<Probe />));
  expect(blocked).toBe(false);
});

it('the queued notice does not block itself, and unmount releases only its own modal', () => {
  let observer!: ReactTestRenderer;
  let first!: ReactTestRenderer;
  let second!: ReactTestRenderer;
  act(() => {
    observer = create(<><Probe /><AppNativeModal blocksNotice={false} visible /></>);
  });
  expect(blocked).toBe(false);
  act(() => { first = create(<AppNativeModal visible />); second = create(<AppNativeModal visible />); });
  expect(blocked).toBe(true);
  act(() => first.unmount());
  expect(blocked).toBe(true);
  act(() => second.unmount());
  expect(blocked).toBe(false);
  act(() => observer.unmount());
});

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, Text } from 'react-native';
import { AppNativeModal } from '../AppNativeModal';

const originalOS = Platform.OS;
afterEach(() => { Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }); });

it.each(['android', 'ios'])('%s: ordinary modal visibility and close/dismiss callbacks remain controlled by its caller', os => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  const dismiss = jest.fn();
  const close = jest.fn();
  const element = (visible: boolean) => <AppNativeModal visible={visible} onDismiss={dismiss} onRequestClose={close}><Text>Existing dialog</Text></AppNativeModal>;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(element(true)); });
  const modal = () => tree.root.findByType(Modal);
  expect(modal().props.visible).toBe(true);
  act(() => modal().props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(1);
  expect(modal().props.visible).toBe(true);
  act(() => tree.update(element(false)));
  expect(modal().props.visible).toBe(false);
  act(() => modal().props.onDismiss());
  expect(dismiss).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

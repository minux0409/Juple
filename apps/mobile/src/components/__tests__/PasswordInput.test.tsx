import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { PasswordInput } from '../PasswordInput';
it('toggles the existing field without losing its value or submission callback', async () => {
  const submit = jest.fn(); let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PasswordInput value="secret" testID="password" onSubmitEditing={submit} />); });
  expect(renderer.root.findByType(TextInput).props.secureTextEntry).toBe(true);
  await act(async () => renderer.root.findAll(node => node.props.testID === 'password-visibility' && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(renderer.root.findByType(TextInput).props.secureTextEntry).toBe(false);
  expect(renderer.root.findByType(TextInput).props.value).toBe('secret');
  renderer.root.findByType(TextInput).props.onSubmitEditing(); expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => renderer.root.findAll(node => node.props.testID === 'password-visibility' && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(renderer.root.findByType(TextInput).props.secureTextEntry).toBe(true);
  await act(async () => renderer.unmount());
});

import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import '../../i18n';
import { SignInScreen } from '../SignInScreen';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));

it.each([false, true])('shows the ordinary Juple sign-in screen with deletion flag %s', async afterDeletion => {
  const signIn = jest.fn();
  const freshSignIn = jest.fn();
  jest.mocked(useAuth).mockReturnValue({
    signIn,
    freshSignIn,
    forceFreshAuthenticationAfterDeletion: afterDeletion,
    isSigningIn: false,
    error: null,
  } as never);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SignInScreen />); });

  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Juple')).toBe(true);
  const button = renderer.root.findByProps({ accessibilityRole: 'button' });
  await act(async () => { button.props.onPress(); });

  expect(signIn).toHaveBeenCalledTimes(afterDeletion ? 0 : 1);
  expect(freshSignIn).toHaveBeenCalledTimes(afterDeletion ? 1 : 0);
});

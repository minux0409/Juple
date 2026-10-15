import ReactTestRenderer, { act } from 'react-test-renderer';
import { useAuth } from '../../auth/AuthContext';
import '../../i18n';
import { PostDeletionScreen } from '../PostDeletionScreen';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));

it('offers distinct fresh sign-up and credential login actions', async () => {
  const freshSignUp = jest.fn();
  const freshSignIn = jest.fn();
  jest.mocked(useAuth).mockReturnValue({ freshSignUp, freshSignIn, isSigningIn: false, error: null } as never);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PostDeletionScreen />); });
  await act(async () => {
    renderer.root.findByProps({ testID: 'post-deletion-sign-up' }).props.onPress();
    renderer.root.findByProps({ testID: 'post-deletion-sign-in' }).props.onPress();
  });
  expect(freshSignUp).toHaveBeenCalledTimes(1);
  expect(freshSignIn).toHaveBeenCalledTimes(1);
});

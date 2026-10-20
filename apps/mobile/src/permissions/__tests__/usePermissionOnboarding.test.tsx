import ReactTestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PERMISSION_REVIEW_KEY,
  usePermissionOnboarding,
} from '../usePermissionOnboarding';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    clear: jest.fn(async () => {
      values.clear();
    }),
  };
});
let result: ReturnType<typeof usePermissionOnboarding>;
function Host({ enabled = true }: { enabled?: boolean }) {
  result = usePermissionOnboarding(enabled);
  return null;
}
let renderer: ReactTestRenderer.ReactTestRenderer;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => {
  act(() => renderer?.unmount());
  jest.restoreAllMocks();
});

it('waits for authentication/Terms and allows Later without an OS grant', async () => {
  await act(async () => {
    renderer = ReactTestRenderer.create(<Host enabled={false} />);
  });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  await act(async () => {
    renderer.update(<Host enabled />);
  });
  expect(result.status).toBe('required');
  await act(async () => {
    await result.complete();
  });
  expect(result.status).toBe('done');
  expect(await AsyncStorage.getItem(PERMISSION_REVIEW_KEY)).toBe('reviewed');
});
it('account switch preserves the explanation choice; a fresh installation gets the explanation again', async () => {
  await AsyncStorage.setItem(PERMISSION_REVIEW_KEY, 'reviewed');
  await act(async () => {
    renderer = ReactTestRenderer.create(<Host />);
  });
  expect(result.status).toBe('done');
  await act(async () => {
    renderer.update(<Host enabled={false} />);
  });
  await act(async () => {
    renderer.update(<Host enabled />);
  });
  expect(result.status).toBe('done');
  act(() => renderer.unmount());
  await AsyncStorage.clear();
  await act(async () => {
    renderer = ReactTestRenderer.create(<Host />);
  });
  expect(result.status).toBe('required');
});
it('storage failure does not block using the app', async () => {
  await act(async () => {
    renderer = ReactTestRenderer.create(<Host />);
  });
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('storage unavailable'));
  await act(async () => {
    await result.complete();
  });
  expect(result.status).toBe('done');
});

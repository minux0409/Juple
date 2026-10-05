import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ApiError } from '../../api/ApiError';
import i18n from '../../i18n';
import { InfoIcon } from '../../icons/InfoIcon';
import { WifiOffIcon } from '../../icons/WifiOffIcon';
import { LoadFailureState, loadFailureVariant } from '../LoadFailureState';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

const textsOf = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => node.props.children);

describe('loadFailureVariant', () => {
  it('calls only a request that never got an answer "offline"', () => {
    expect(loadFailureVariant(new ApiError('unavailable'))).toBe('offline');
    expect(loadFailureVariant(new ApiError('timeout'))).toBe('offline');
  });

  it('never claims offline for a server that answered, or for an error it does not recognise', () => {
    expect(loadFailureVariant(new ApiError('unavailable', 503))).toBe('loadFailed');
    expect(loadFailureVariant(new ApiError('notFound', 404))).toBe('loadFailed');
    expect(loadFailureVariant(new ApiError('unauthorized', 401))).toBe('loadFailed');
    expect(loadFailureVariant(new Error('boom'))).toBe('loadFailed');
    expect(loadFailureVariant(undefined)).toBe('loadFailed');
  });
});

describe('LoadFailureState', () => {
  it('offline: 연결할 수 없어요 with the network-off icon, the connection hint and 다시 시도', () => {
    const onRetry = jest.fn();
    const renderer = render(<LoadFailureState error={new ApiError('unavailable')} message="목록을 불러오지 못했어요." onRetry={onRetry} testID="x" />);

    expect(textsOf(renderer)).toEqual([i18n.t('importantState.offlineTitle'), i18n.t('importantState.offlineMessage'), '다시 시도']);
    expect(textsOf(renderer)[0]).toBe('연결할 수 없어요');
    expect(renderer.root.findAllByType(WifiOffIcon)).toHaveLength(1);
    act(() => {
      renderer.root.find(node => node.props.testID === 'x-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('load failed: 불러오지 못했어요 with the info icon and the surface\'s own message', () => {
    const renderer = render(<LoadFailureState error={new ApiError('notFound', 404)} message="목록을 불러오지 못했어요." onRetry={() => undefined} />);

    expect(textsOf(renderer)).toEqual(['불러오지 못했어요', '목록을 불러오지 못했어요.', '다시 시도']);
    expect(renderer.root.findAllByType(InfoIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(WifiOffIcon)).toHaveLength(0);
  });

  it('has no retry button when nothing can be retried', () => {
    const renderer = render(<LoadFailureState message="이 컬렉션은 소유자만 열 수 있어요." />);
    expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
  });
});

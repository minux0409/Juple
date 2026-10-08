import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ApiError } from '../../api/ApiError';
import i18n from '../../i18n';
import { InfoIcon } from '../../icons/InfoIcon';
import { BrokenLinkIcon } from '../../icons/BrokenLinkIcon';
import { isDefinitiveLoadError, LoadFailureState, loadFailureVariant } from '../LoadFailureState';

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
const STANDARD = ['불러오지 못했어요', '기록을 불러올 수 없습니다.', '다시 시도'];

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

describe('isDefinitiveLoadError', () => {
  it('is a definite answer (gone, not allowed, signed out, not ready) - never a network or server failure', () => {
    expect(isDefinitiveLoadError(new ApiError('notFound', 404))).toBe(true);
    expect(isDefinitiveLoadError(new ApiError('forbidden', 403))).toBe(true);
    expect(isDefinitiveLoadError(new ApiError('unauthorized', 401))).toBe(true);
    expect(isDefinitiveLoadError(new ApiError('conflict', 409))).toBe(true);
    expect(isDefinitiveLoadError(new ApiError('unavailable'))).toBe(false);
    expect(isDefinitiveLoadError(new ApiError('unavailable', 503))).toBe(false);
    expect(isDefinitiveLoadError(new Error('boom'))).toBe(false);
  });
});

describe('LoadFailureState', () => {
  it('offline: the broken chain link, with the SAME words as any load failure, and 다시 시도', () => {
    const onRetry = jest.fn();
    const renderer = render(<LoadFailureState error={new ApiError('unavailable')} onRetry={onRetry} testID="x" />);

    expect(textsOf(renderer)).toEqual(STANDARD);
    expect(renderer.root.findAllByType(BrokenLinkIcon)).toHaveLength(1);
    act(() => {
      renderer.root.find(node => node.props.testID === 'x-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server failure', new ApiError('unavailable', 500)],
    ['an unrecognised error', new Error('boom')],
    ['a screen that kept only a message string', '컬렉션을 불러오지 못했어요.'],
    ['no error at all', undefined],
  ])('%s: the SAME broken chain link and words as offline - never the info circle', (_label, error) => {
    const renderer = render(<LoadFailureState error={error} onRetry={() => undefined} />);

    expect(textsOf(renderer)).toEqual(STANDARD);
    expect(renderer.root.findAllByType(BrokenLinkIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(InfoIcon)).toHaveLength(0);
  });

  it('compact (a nested sheet / popup) is still the broken chain link and the standard words', () => {
    const renderer = render(<LoadFailureState compact onRetry={() => undefined} />);
    expect(textsOf(renderer)).toEqual(STANDARD);
    expect(renderer.root.findAllByType(BrokenLinkIcon)).toHaveLength(1);
  });

  it('a definite state is said as itself, and has no retry button when nothing can be retried', () => {
    const renderer = render(<LoadFailureState error={new ApiError('forbidden', 403)} notice="이 컬렉션은 소유자만 열 수 있어요." />);
    expect(textsOf(renderer)).toEqual(['이 컬렉션은 소유자만 열 수 있어요.']);
    expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
    // Not a failure to load: it keeps the notice look, not the broken link.
    expect(renderer.root.findAllByType(InfoIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(BrokenLinkIcon)).toHaveLength(0);
  });
});

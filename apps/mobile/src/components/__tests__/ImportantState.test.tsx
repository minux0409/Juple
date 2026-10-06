import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ImportantState } from '../ImportantState';

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

describe('ImportantState', () => {
  it('a load failure always reads the one app-wide text, with a working retry', () => {
    const onRetry = jest.fn();
    const renderer = render(<ImportantState onRetry={onRetry} />);

    expect(textsOf(renderer)).toEqual(STANDARD);
    act(() => {
      renderer.root.find(node => node.props.testID === 'important-state-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offline says exactly the same words (only its icon differs) - no transport detail in the copy', () => {
    const renderer = render(<ImportantState onRetry={() => undefined} variant="offline" />);
    expect(textsOf(renderer)).toEqual(STANDARD);
  });

  it('a screen-specific sentence or headline can never replace the load-failure text', () => {
    const renderer = render(<ImportantState message="컬렉션 목록을 불러오지 못했어요." onRetry={() => undefined} title="custom" />);
    expect(textsOf(renderer)).toEqual(STANDARD);
  });

  it('a notice keeps its own specific sentence (a definite state, not a failure to load)', () => {
    const renderer = render(<ImportantState message="이 컬렉션을 찾을 수 없어요." variant="notice" />);
    expect(textsOf(renderer)).toEqual(['이 컬렉션을 찾을 수 없어요.']);
  });

  it('has no retry button without a callback, and the empty variant has no headline', () => {
    const renderer = render(<ImportantState message="아직 알림이 없어요." variant="empty" />);
    expect(textsOf(renderer)).toEqual(['아직 알림이 없어요.']);
    expect(renderer.root.findAll(node => node.props.testID === 'important-state-retry')).toHaveLength(0);
  });

  it('is announced politely and its retry meets the minimum touch target', () => {
    const renderer = render(<ImportantState onRetry={() => undefined} />);
    expect(renderer.root.findAll(node => node.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
    const retry = renderer.root.find(node => node.props.testID === 'important-state-retry' && typeof node.props.onPress === 'function');
    expect(JSON.stringify(retry.props.style)).toContain('"minHeight":44');
  });
});

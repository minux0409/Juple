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

describe('ImportantState', () => {
  it('shows a headline, the message and a working retry for a load failure', () => {
    const onRetry = jest.fn();
    const renderer = render(<ImportantState message="컬렉션 목록을 불러오지 못했어요." onRetry={onRetry} />);

    expect(textsOf(renderer)).toEqual(['불러오지 못했어요', '컬렉션 목록을 불러오지 못했어요.', '다시 시도']);
    act(() => {
      renderer.root.find(node => node.props.testID === 'important-state-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('the offline variant says it cannot connect', () => {
    const renderer = render(<ImportantState message="연결을 확인해 주세요." variant="offline" />);
    expect(textsOf(renderer)[0]).toBe('연결할 수 없어요');
  });

  it('has no retry button without a callback, and the empty variant has no headline', () => {
    const renderer = render(<ImportantState message="아직 알림이 없어요." variant="empty" />);
    expect(textsOf(renderer)).toEqual(['아직 알림이 없어요.']);
    expect(renderer.root.findAll(node => node.props.testID === 'important-state-retry')).toHaveLength(0);
  });

  it('a custom headline and retry label win over the defaults', () => {
    const renderer = render(<ImportantState message="m" onRetry={() => undefined} retryLabel="again" title="custom" />);
    expect(textsOf(renderer)).toEqual(['custom', 'm', 'again']);
  });

  it('is announced politely and its retry meets the minimum touch target', () => {
    const renderer = render(<ImportantState message="m" onRetry={() => undefined} />);
    expect(renderer.root.findAll(node => node.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
    const retry = renderer.root.find(node => node.props.testID === 'important-state-retry' && typeof node.props.onPress === 'function');
    expect(JSON.stringify(retry.props.style)).toContain('"minHeight":44');
  });
});

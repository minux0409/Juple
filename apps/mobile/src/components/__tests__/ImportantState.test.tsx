import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ImportantState } from '../ImportantState';
import { BrokenLinkIcon } from '../../icons/BrokenLinkIcon';
import { InfoIcon } from '../../icons/InfoIcon';

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

  it('offline and loadFailed are one state: the same words and the same broken chain link (no transport detail)', () => {
    for (const variant of ['offline', 'loadFailed'] as const) {
      const renderer = render(<ImportantState onRetry={() => undefined} variant={variant} />);
      expect(textsOf(renderer)).toEqual(STANDARD);
      expect(renderer.root.findAllByType(BrokenLinkIcon)).toHaveLength(1);
      expect(renderer.root.findAllByType(InfoIcon)).toHaveLength(0);
      // Decorative: the icon is hidden from screen readers (the text says it).
      const iconCircle = renderer.root.find(node => node.props.importantForAccessibility === 'no-hide-descendants' && typeof node.type === 'string');
      expect(iconCircle.findAllByType(BrokenLinkIcon)).toHaveLength(1);
    }
  });

  it('a notice keeps the info circle - it is a definite state, not a failure to load', () => {
    const renderer = render(<ImportantState message="이 컬렉션을 찾을 수 없어요." variant="notice" />);
    expect(renderer.root.findAllByType(InfoIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(BrokenLinkIcon)).toHaveLength(0);
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

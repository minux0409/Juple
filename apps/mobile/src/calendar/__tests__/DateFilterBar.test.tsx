import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nManager, Text } from 'react-native';
import i18n from '../../i18n';
import { ArrowHeadIcon } from '../../icons/ArrowHeadIcon';
import { DateFilterBar } from '../DateFilterBar';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const baseProps = {
  canGoNext: true,
  counts: new Map<string, number>([['2026-09-23', 2]]),
  isOpen: true,
  month: { year: 2026, month: 9 },
  onClear: jest.fn(),
  onNextMonth: jest.fn(),
  onPreviousMonth: jest.fn(),
  onRetryMonth: jest.fn(),
  onSelectDate: jest.fn(),
  onToggleOpen: jest.fn(),
  selectedDate: null,
  status: 'ready' as const,
  testIDPrefix: 'f',
  today: '2026-09-30',
};

function render(overrides: Partial<React.ComponentProps<typeof DateFilterBar>> = {}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<DateFilterBar {...baseProps} {...overrides} />);
  });
  return renderer;
}

const pressable = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');

/** The arrow drawn inside one of the month buttons. */
const arrowIn = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  pressable(renderer, testID).findByType(ArrowHeadIcon).props.direction;

function setRtl(isRTL: boolean) {
  Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: isRTL });
}

afterEach(() => {
  setRtl(false);
  jest.clearAllMocks();
});

describe('DateFilterBar', () => {
  it('is a "날짜 선택" control that expands the month calendar - never a view mode', () => {
    const closed = render({ isOpen: false });
    expect(Text && closed.root.findAllByType(Text).map(node => node.props.children)).toContain(i18n.t('calendar.pickDate'));
    expect(closed.root.findAll(node => node.props.testID === 'f-calendar')).toHaveLength(0);

    act(() => pressable(closed, 'f-toggle').props.onPress());
    expect(baseProps.onToggleOpen).toHaveBeenCalledTimes(1);

    const open = render();
    expect(open.root.findAll(node => node.props.testID === 'f-calendar').length).toBeGreaterThan(0);
  });

  it('shows the chosen date with an X that goes back to every date', () => {
    const renderer = render({ isOpen: false, selectedDate: '2026-09-23' });
    const labels = renderer.root.findAllByType(Text).map(node => String(node.props.children));
    expect(labels.some(label => label.startsWith('날짜:') && label.includes('2026'))).toBe(true);

    act(() => pressable(renderer, 'f-clear').props.onPress());
    expect(baseProps.onClear).toHaveBeenCalledTimes(1);
    expect(pressable(renderer, 'f-clear').props.accessibilityLabel).toBe(i18n.t('calendar.clearDateA11y'));
  });

  it('hands the tapped day over as a plain date', () => {
    const renderer = render();
    act(() => pressable(renderer, 'f-calendar-day-2026-09-23').props.onPress());
    expect(baseProps.onSelectDate).toHaveBeenCalledWith('2026-09-23');
  });

  describe('month arrows', () => {
    it('LTR: "<" on the left goes to the previous month, ">" on the right to the next', () => {
      setRtl(false);
      const renderer = render();
      expect(arrowIn(renderer, 'f-calendar-prev')).toBe('left');
      expect(arrowIn(renderer, 'f-calendar-next')).toBe('right');
      expect(pressable(renderer, 'f-calendar-prev').props.accessibilityLabel).toBe(i18n.t('calendar.previousMonthA11y'));
      expect(pressable(renderer, 'f-calendar-next').props.accessibilityLabel).toBe(i18n.t('calendar.nextMonthA11y'));

      act(() => pressable(renderer, 'f-calendar-prev').props.onPress());
      act(() => pressable(renderer, 'f-calendar-next').props.onPress());
      expect(baseProps.onPreviousMonth).toHaveBeenCalledTimes(1);
      expect(baseProps.onNextMonth).toHaveBeenCalledTimes(1);
    });

    it('RTL: mirrored - the previous month is ">" (on the start side, which is the right) and the next is "<"', () => {
      setRtl(true);
      const renderer = render();
      expect(arrowIn(renderer, 'f-calendar-prev')).toBe('right');
      expect(arrowIn(renderer, 'f-calendar-next')).toBe('left');
      // The action each button performs does not change with the direction it is drawn in.
      act(() => pressable(renderer, 'f-calendar-prev').props.onPress());
      expect(baseProps.onPreviousMonth).toHaveBeenCalledTimes(1);
    });

    it('does not go past the current month', () => {
      const renderer = render({ canGoNext: false });
      expect(pressable(renderer, 'f-calendar-next').props.disabled).toBe(true);
    });
  });
});

import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import i18n from '../../i18n';
import { GroupingModeToggle } from '../GroupingModeToggle';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function render(value: 'grouped' | 'continuous', onChange = jest.fn()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<GroupingModeToggle onChange={onChange} testID="g" value={value} />);
  });
  return { renderer, onChange };
}
const option = (renderer: ReactTestRenderer.ReactTestRenderer, mode: string) =>
  renderer.root.find(node => node.props.testID === `g-${mode}` && typeof node.props.onPress === 'function');

describe('GroupingModeToggle', () => {
  it('offers 날짜별 and 전체 as one radio group, marking the current one', () => {
    const { renderer } = render('continuous');
    expect(option(renderer, 'grouped').props.accessibilityLabel).toBe('날짜별');
    expect(option(renderer, 'continuous').props.accessibilityLabel).toBe('전체');
    expect(option(renderer, 'grouped').props.accessibilityState).toEqual({ selected: false });
    expect(option(renderer, 'continuous').props.accessibilityState).toEqual({ selected: true });
  });

  it('reports the tapped mode', () => {
    const { renderer, onChange } = render('grouped');
    act(() => option(renderer, 'continuous').props.onPress());
    expect(onChange).toHaveBeenCalledWith('continuous');
  });

  it('keeps a 44dp touch target and lets a long label shrink instead of overflowing', () => {
    const { renderer } = render('grouped');
    const button = option(renderer, 'grouped');
    const style = StyleSheet.flatten(button.props.style);
    expect(style.height + button.props.hitSlop.top + button.props.hitSlop.bottom).toBeGreaterThanOrEqual(44);
    expect(style.flexShrink).toBe(1);
    expect(button.findAll(node => node.props.numberOfLines === 1).length).toBeGreaterThan(0);
  });
});

import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, TextInput } from 'react-native';
import { SearchField } from '../SearchField';
import { SearchIcon } from '../../icons/SearchIcon';
import { CloseIcon } from '../../icons/CloseIcon';
import { colors } from '../../theme/tokens';

const create = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};
const field = (value: string, onChangeText = jest.fn()) =>
  create(<SearchField clearLabel="검색어 지우기" onChangeText={onChangeText} placeholder="링크 검색" testID="s" value={value} />);

describe('SearchField', () => {
  it('draws a muted magnifier at the start of the field, before the input - decorative, not a control', () => {
    const renderer = field('');

    const icon = renderer.root.findAllByType(SearchIcon);
    expect(icon).toHaveLength(1);
    expect(icon[0].props.color).toBe(colors.textSecondary);
    const holder = renderer.root.findAll(node => node.props.testID === 's-icon' && typeof node.type === 'string')[0];
    expect(holder.props.pointerEvents).toBe('none');
    expect(holder.props.accessibilityElementsHidden).toBe(true);
    expect(StyleSheet.flatten(holder.props.style)).toMatchObject({ position: 'absolute', justifyContent: 'center', alignItems: 'center' });
    // It comes before the input in the field, and the input leaves room for it (start padding > the icon's slot).
    const children = holder.parent!.parent!.children as ReactTestRenderer.ReactTestInstance[];
    expect(children.findIndex(child => child.findAll(node => node === holder).length > 0)).toBeLessThan(children.findIndex(child => child.type === TextInput));
    expect(StyleSheet.flatten(renderer.root.findByType(TextInput).props.style).paddingStart).toBeGreaterThanOrEqual(12 + 18);
  });

  it('keeps the placeholder, the label and the typing unchanged', () => {
    const onChangeText = jest.fn();
    const renderer = field('ab', onChangeText);
    const input = renderer.root.findByType(TextInput);

    expect(input.props.placeholder).toBe('링크 검색');
    expect(input.props.accessibilityLabel).toBe('링크 검색');
    expect(input.props.value).toBe('ab');
    act(() => input.props.onChangeText('abc'));
    expect(onChangeText).toHaveBeenCalledWith('abc');
  });

  it('shows the clear button (unchanged) only with text, and it clears', () => {
    expect(field('').root.findAllByType(CloseIcon)).toHaveLength(0);

    const onChangeText = jest.fn();
    const renderer = field('abc', onChangeText);
    const clear = renderer.root.findAll(node => node.props.testID === 's-clear' && typeof node.props.onPress === 'function')[0];
    expect(clear.props.accessibilityLabel).toBe('검색어 지우기');
    act(() => clear.props.onPress());
    expect(onChangeText).toHaveBeenCalledWith('');
  });
});

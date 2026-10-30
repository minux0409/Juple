import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { minTouchTarget, spacing } from '../../theme/tokens';
import { ActionMenuDialog } from '../ActionMenuDialog';

const render = (props: Partial<React.ComponentProps<typeof ActionMenuDialog>> = {}) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ActionMenuDialog
        actions={[{ label: '복사', onPress: jest.fn() }, { label: '삭제', destructive: true, onPress: jest.fn() }]}
        cancelLabel="취소"
        onCancel={jest.fn()}
        visible
        {...props}
      />,
    );
  });
  return renderer;
};

describe('ActionMenuDialog', () => {
  it('취소 is a compact centred row - small padding above AND below its label, never under the 44pt target - and shows its press', () => {
    const onCancel = jest.fn();
    const renderer = render({ onCancel });
    const cancel = renderer.root.findAll(node => node.props.testID === 'action-menu-cancel' && typeof node.props.style === 'function')[0];
    const style = StyleSheet.flatten(cancel.props.style({ pressed: false }));
    expect(style).toEqual(expect.objectContaining({ minHeight: minTouchTarget, paddingVertical: spacing.sm, justifyContent: 'center' }));
    expect(StyleSheet.flatten(cancel.props.style({ pressed: true })).backgroundColor).toBeDefined();
    act(() => cancel.props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('without a header it is exactly what it was: the actions and 취소', () => {
    const renderer = render();

    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toEqual(['복사', '삭제', '취소']);
  });

  it('a header is drawn above the actions, with the actions untouched below it', () => {
    const renderer = render({ header: <Text testID="header-content">리액션</Text> });

    const texts = renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(texts).toEqual(['리액션', '복사', '삭제', '취소']);
  });

  it('a header with no actions still shows (a menu that is only the header and 취소)', () => {
    const renderer = render({ actions: [], header: <Text>리액션</Text> });

    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toEqual(['리액션', '취소']);
  });
});

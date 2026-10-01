import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
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

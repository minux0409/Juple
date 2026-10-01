import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { DialogActions, type DialogAction } from '../DialogActions';
import { ConfirmDialog } from '../ConfirmDialog';
import { colors, minTouchTarget } from '../../theme/tokens';

async function render(actions: DialogAction[]) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<DialogActions actions={actions} />);
  });
  return renderer;
}

const row = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'dialog-actions' && node.props.style)[0];
/** One instance per action: the Pressable (its host View has no onPress). */
const buttons = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function');
const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};

/** What the native text layout reports for a label rendered on `lineCount` lines. */
async function layOut(renderer: ReactTestRenderer.ReactTestRenderer, label: string, lineCount: number) {
  const text = renderer.root.findAllByType(Text).find(node => node.props.children === label)!;
  await act(async () => {
    text.props.onTextLayout({ nativeEvent: { lines: Array.from({ length: lineCount }, () => ({ text: '' })) } });
  });
}

const pair = (confirmLabel = 'Remove from collection'): DialogAction[] => [
  { label: 'Cancel', onPress: jest.fn(), tone: 'secondary' },
  { label: confirmLabel, onPress: jest.fn(), tone: 'destructive' },
];

describe('DialogActions', () => {
  it('puts two actions side by side as equal halves, each label centered, each at least 44dp tall', async () => {
    const renderer = await render(pair());

    expect(flat(row(renderer).props.style).flexDirection).toBe('row');
    expect(buttons(renderer)).toHaveLength(2);
    for (const button of buttons(renderer)) {
      const style = flat(button.props.style);
      // flexBasis 0 + flexGrow 1: a longer label never makes its own half wider.
      expect(style).toEqual(expect.objectContaining({ flexBasis: 0, flexGrow: 1, minHeight: minTouchTarget, justifyContent: 'center', alignItems: 'center' }));
    }
    for (const label of renderer.root.findAllByType(Text)) {
      expect(flat(label.props.style).textAlign).toBe('center');
      // No line cap and no shrinking - a long translation wraps, it is never cut.
      expect(label.props.numberOfLines).toBeUndefined();
      expect(label.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  it('a label wrapping onto two lines stays side by side', async () => {
    const renderer = await render(pair());

    await layOut(renderer, 'Remove from collection', 2);

    expect(flat(row(renderer).props.style).flexDirection).toBe('row');
  });

  it('stacks full-width, in the same order, once a label would need more than two lines', async () => {
    const renderer = await render(pair('Aus der Sammlung entfernen und nicht mehr anzeigen'));

    await layOut(renderer, 'Aus der Sammlung entfernen und nicht mehr anzeigen', 3);

    expect(flat(row(renderer).props.style).flexDirection).toBe('column');
    const [first, second] = buttons(renderer);
    expect(first.props.accessibilityLabel).toBe('Cancel');
    expect(second.props.accessibilityLabel).toBe('Aus der Sammlung entfernen und nicht mehr anzeigen');
    for (const button of buttons(renderer)) {
      expect(flat(button.props.style)).toEqual(expect.objectContaining({ alignSelf: 'stretch', minHeight: minTouchTarget }));
    }
  });

  it('new labels (another language) get a fresh side-by-side attempt', async () => {
    const renderer = await render(pair('Aus der Sammlung entfernen und nicht mehr anzeigen'));
    await layOut(renderer, 'Aus der Sammlung entfernen und nicht mehr anzeigen', 3);

    await act(async () => {
      renderer.update(<DialogActions actions={pair('삭제')} />);
    });

    expect(flat(row(renderer).props.style).flexDirection).toBe('row');
  });

  it('colors: destructive is the danger fill, secondary is outlined; disabled/busy actions cannot be pressed', async () => {
    const onPress = jest.fn();
    const renderer = await render([
      { label: 'Cancel', onPress, tone: 'secondary', disabled: true },
      { label: 'Delete', onPress, tone: 'destructive', busy: true, disabled: true },
    ]);
    const [cancel, confirm] = buttons(renderer);

    expect(flat(confirm.props.style).backgroundColor).toBe(colors.danger);
    expect(flat(cancel.props.style)).toEqual(expect.objectContaining({ borderWidth: 1 }));
    expect(flat(cancel.props.style).backgroundColor).toBeUndefined();
    expect(cancel.props.disabled).toBe(true);
    expect(confirm.props.accessibilityState).toEqual({ disabled: true, busy: true });
    // Busy shows a spinner in place of the label (the button keeps its size and its a11y label).
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toEqual(['Cancel']);
    expect(confirm.props.accessibilityLabel).toBe('Delete');
  });
});

describe('ConfirmDialog - uses DialogActions', () => {
  it('a long English confirm label is centered in its half, with the cancel half beside it', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Remove from collection"
          message="The link stays in your library."
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
          title="Remove this link?"
          visible
        />,
      );
    });

    const actions = renderer.root.findByType(DialogActions);
    expect(actions.props.actions.map((action: DialogAction) => [action.label, action.tone])).toEqual([
      ['Cancel', 'secondary'],
      ['Remove from collection', 'destructive'],
    ]);
    const label = renderer.root.findAllByType(Text).find(node => node.props.children === 'Remove from collection')!;
    expect(flat(label.props.style).textAlign).toBe('center');
  });
});

import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ConfirmDialog } from '../ConfirmDialog';

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}
const dialog = (
  <ConfirmDialog cancelLabel="닫기" confirmLabel="멤버십 보기" message={'긴 안내 '.repeat(200)} onCancel={jest.fn()} onConfirm={jest.fn()} title="멤버십이 필요한 기능이에요" visible />
);

describe('ConfirmDialog with a long text or a large accessibility font', () => {
  it('scrolls its words inside a card no taller than the screen, so both buttons always stay on screen', () => {
    const renderer = render(dialog);
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.findAllByType(Text).map(node => node.props.children)).toEqual(['멤버십이 필요한 기능이에요', '긴 안내 '.repeat(200)]);
    // The buttons are outside the scrolling part.
    expect(scroll.findAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
    const card = renderer.root.findAll(node => node.props.accessibilityViewIsModal === true && typeof node.type === 'string')[0];
    expect(StyleSheet.flatten(card.props.style).maxHeight).toBe('100%');
  });

  it('on iOS the overlay keeps the card inside the real safe-area insets (status bar, home indicator)', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const renderer = render(
      <SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}>{dialog}</SafeAreaInsetsContext.Provider>,
    );
    const card = renderer.root.findAll(node => node.props.accessibilityViewIsModal === true && typeof node.type === 'string')[0];
    let host = card.parent!;
    while (typeof host.type !== 'string') {
      host = host.parent!;
    }
    const overlay = StyleSheet.flatten(host.props.style);
    expect(overlay.paddingTop).toBeGreaterThanOrEqual(59);
    expect(overlay.paddingBottom).toBeGreaterThanOrEqual(34);
  });

  it('still renders without any safe-area provider (a dialog on its own, a test)', () => {
    expect(() => render(dialog)).not.toThrow();
  });
});

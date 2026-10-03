import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { InfoIcon } from '../../icons/InfoIcon';
import { InfoCallout } from '../InfoCallout';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const message = () => i18n.t('shareSheet.publicInfo');

async function render() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<InfoCallout accessibilityLabel={i18n.t('shareSheet.publicInfoA11y')} message={message()} testID="info" />);
  });
  const button = () => renderer.root.findAll(node => node.props.testID === 'info' && typeof node.props.onPress === 'function')[0];
  const isOpen = () => renderer.root.findByType(Modal).props.visible === true;
  return { renderer, button, isOpen };
}

describe('InfoCallout', () => {
  it('is a small muted info glyph in a full 44dp button with a localized accessibility label', async () => {
    const { button } = await render();

    expect(button().props.accessibilityRole).toBe('button');
    expect(button().props.accessibilityLabel).toBe('공용 컬렉션 안내');
    const style = StyleSheet.flatten(button().props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(button().findByType(InfoIcon).props.size).toBeLessThan(24);
  });

  it('tap opens the explanation (exactly the project text, no action buttons); the info button again closes it', async () => {
    const { renderer, button, isOpen } = await render();
    expect(isOpen()).toBe(false);

    await act(async () => {
      button().props.onPress();
    });
    expect(isOpen()).toBe(true);
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toContain(
      '컬렉션의 링크를 알고 있는 사람은 누구나 컬렉션에 접근할 수 있습니다.\n접근하는 사용자에 대한 공통 권한을 설정할 수 있으며, 직접 초대한 사용자에 대해서는 상위 권한을 별도로 지정할 수 있습니다.\n참여자 목록에서도 수정할 수 있습니다.',
    );
    const modal = renderer.root.findByType(Modal);
    expect(modal.props.transparent).toBe(true);
    expect(button().props.accessibilityState).toEqual({ expanded: true });

    await act(async () => {
      button().props.onPress();
    });
    expect(isOpen()).toBe(false);
  });

  it('tapping outside and the back button both dismiss', async () => {
    const { renderer, button, isOpen } = await render();
    await act(async () => {
      button().props.onPress();
    });
    await act(async () => {
      renderer.root.findAll(node => node.props.testID === 'info-dismiss' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(isOpen()).toBe(false);

    await act(async () => {
      button().props.onPress();
    });
    await act(async () => {
      renderer.root.findByType(Modal).props.onRequestClose();
    });
    expect(isOpen()).toBe(false);
  });

  it('the callout is window-wide minus its side margins, so it cannot clip at narrow widths', async () => {
    const { renderer, button } = await render();
    await act(async () => {
      button().props.onPress();
    });
    const callout = renderer.root.findAll(node => node.props.testID === 'info-message')[0];
    expect(StyleSheet.flatten(callout.props.style).width).toBeGreaterThan(0);
    expect(StyleSheet.flatten(callout.props.style).position).toBe('absolute');
  });
});

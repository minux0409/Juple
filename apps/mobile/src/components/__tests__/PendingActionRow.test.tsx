import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { BellIcon } from '../../icons/BellIcon';
import { ChevronIcon } from '../../icons/ChevronIcon';
import { colors, minTouchTarget } from '../../theme/tokens';
import { PENDING_ROW_ICON_SIZE, PendingActionRow } from '../PendingActionRow';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

async function render(label: string, onPress = jest.fn()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<PendingActionRow accessibilityLabel={label} label={label} onPress={onPress} testID="row" />);
  });
  return renderer;
}

describe('PendingActionRow (the one shared requester + owner row)', () => {
  it('shows a decorative blue bell before the label and a chevron after it, in a compact one-line row', async () => {
    const renderer = await render('보낸 승인 요청 3');
    const row = renderer.root.findByType(PendingActionRow).children[0] as ReactTestRenderer.ReactTestInstance;

    const bell = row.findByType(BellIcon);
    expect(bell.props).toMatchObject({ color: colors.brandText, size: PENDING_ROW_ICON_SIZE });
    expect(PENDING_ROW_ICON_SIZE).toBeGreaterThanOrEqual(18);
    expect(PENDING_ROW_ICON_SIZE).toBeLessThanOrEqual(20);
    const wrapper = renderer.root.findAll(node => node.props.testID === 'row-icon')[0];
    expect(wrapper.props.accessibilityElementsHidden).toBe(true);
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wrapper.props.onPress).toBeUndefined();
    expect(row.findAllByType(ChevronIcon)).toHaveLength(1);
    expect(row.findAllByType(Text)).toHaveLength(1);
    const style = StyleSheet.flatten(row.props.style({ pressed: false }));
    expect(style).toMatchObject({ flexDirection: 'row', backgroundColor: colors.brandSoft, borderColor: colors.brandText, minHeight: minTouchTarget });
  });

  it('the whole row is one button with the given spoken label and handler', async () => {
    const onPress = jest.fn();
    const renderer = await render('받은 승인 요청 4', onPress);
    const row = renderer.root.findByType(PendingActionRow).children[0] as ReactTestRenderer.ReactTestInstance;
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('받은 승인 요청 4');
    act(() => row.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('requester (보낸 승인 요청) and owner (받은 승인 요청) wording stay different but share this component', () => {
    expect(i18n.t('collections.myPendingSubmissions', { count: 3 })).toBe('보낸 승인 요청');
    expect(i18n.t('collections.pendingSubmissions', { count: 4 })).toBe('받은 승인 요청');
    expect(i18n.t('submissions.mySheetTitle')).toBe('보낸 승인 요청');
    expect(i18n.t('submissions.ownerSheetTitle')).toBe('받은 승인 요청');
  });
});

describe('PendingActionRow status variant (what I only wait for)', () => {
  async function renderVariant(variant?: 'action' | 'status') {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PendingActionRow accessibilityLabel="x" count={2} label="x" onPress={jest.fn()} statusText="대기 2건" testID="row" variant={variant} />);
    });
    const row = renderer.root.findAll(node => node.props.testID === 'row' && typeof node.props.style === 'function')[0];
    const style = StyleSheet.flatten(row.props.style({ pressed: false }));
    return { renderer, style };
  }
  const byId = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) => renderer.root.findAll(node => node.props.testID === id && typeof node.type === 'string');

  it('an action row keeps the blue card with a red count badge and no status text', async () => {
    const { renderer, style } = await renderVariant();
    expect(style).toMatchObject({ backgroundColor: colors.brandSoft, borderColor: colors.brandText });
    expect(byId(renderer, 'row-badge')).toHaveLength(1);
    expect(byId(renderer, 'row-status')).toHaveLength(0);
  });

  it('a status row is a quiet neutral card with "대기 n건" and no badge - same height, rounding and chevron', async () => {
    const action = await renderVariant();
    const { renderer, style } = await renderVariant('status');
    expect(style).toMatchObject({ backgroundColor: colors.surface, borderColor: colors.inputBorder });
    expect(style.backgroundColor).not.toBe(colors.brandSoft);
    expect(style.minHeight).toBe(action.style.minHeight);
    expect(style.borderRadius).toBe(action.style.borderRadius);
    expect(byId(renderer, 'row-badge')).toHaveLength(0);
    expect(byId(renderer, 'row-status')[0].props.children).toBe('대기 2건');
    expect(renderer.root.findAllByType(ChevronIcon)).toHaveLength(1);
  });
});

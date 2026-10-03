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
    expect(bell.props).toMatchObject({ color: colors.brand, size: PENDING_ROW_ICON_SIZE });
    expect(PENDING_ROW_ICON_SIZE).toBeGreaterThanOrEqual(18);
    expect(PENDING_ROW_ICON_SIZE).toBeLessThanOrEqual(20);
    const wrapper = renderer.root.findAll(node => node.props.testID === 'row-icon')[0];
    expect(wrapper.props.accessibilityElementsHidden).toBe(true);
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wrapper.props.onPress).toBeUndefined();
    expect(row.findAllByType(ChevronIcon)).toHaveLength(1);
    expect(row.findAllByType(Text)).toHaveLength(1);
    const style = StyleSheet.flatten(typeof row.props.style === 'function' ? row.props.style({ pressed: false }) : row.props.style);
    expect(style).toMatchObject({ flexDirection: 'row', backgroundColor: colors.brandSoft, borderColor: colors.brand, minHeight: minTouchTarget });
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
    expect(i18n.t('collections.myPendingSubmissions', { count: 3 })).toBe('보낸 승인 요청 3');
    expect(i18n.t('collections.pendingSubmissions', { count: 4 })).toBe('받은 승인 요청 4');
    expect(i18n.t('submissions.mySheetTitle')).toBe('보낸 승인 요청');
    expect(i18n.t('submissions.ownerSheetTitle')).toBe('받은 승인 요청');
  });
});

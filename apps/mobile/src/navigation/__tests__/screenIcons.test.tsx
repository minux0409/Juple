import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { ScreenTitle, SCREEN_TITLE_ICON_SIZE } from '../../components/ScreenTitle';
import { ArchiveIcon } from '../../icons/ArchiveIcon';
import { ClockIcon } from '../../icons/ClockIcon';
import { headerTitleWithIcon, screenIcons } from '../screenIcons';

describe('navigation identity: one icon per navigation item', () => {
  it('보관함 uses an archive (storage box) icon - not the History clock', () => {
    expect(screenIcons.archive).toBe(ArchiveIcon);
    expect(screenIcons.archive).not.toBe(ClockIcon);
  });

  it('the bottom tabs, 내 페이지 rows and screen titles read the same map (a tab icon can never differ from its title icon)', () => {
    const tabs: string = require('fs').readFileSync(require('path').resolve(__dirname, '../MainTabs.tsx'), 'utf8');
    expect(tabs).toMatch(/screenIcons\.home/);
    expect(tabs).toMatch(/screenIcons\.archive/);
    expect(tabs).toMatch(/screenIcons\.collections/);
    expect(tabs).toMatch(/screenIcons\.myPage/);
    expect(tabs).not.toMatch(/ClockIcon/);
    const stack: string = require('fs').readFileSync(require('path').resolve(__dirname, '../RootStack.tsx'), 'utf8');
    for (const key of ['friends', 'language', 'collectionLock', 'trash', 'contact', 'account']) {
      expect(stack).toMatch(new RegExp(`screenIcons\\.${key}`));
    }
  });

  it('every title uses the same icon size, in the brand color, with the title text beside it', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<ScreenTitle icon={screenIcons.friends} title="Friends" />);
    });

    const icon = renderer.root.findByType(screenIcons.friends);
    expect(icon.props.size).toBe(SCREEN_TITLE_ICON_SIZE);
    expect(renderer.root.findByType(Text).props.children).toBe('Friends');
    expect(renderer.root.findByType(Text).props.accessibilityRole).toBe('header');
    // Icon first, then text, in one row with a fixed gap; long text shrinks (never the icon).
    const row = renderer.root.findByType(Text).parent!;
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
    expect(StyleSheet.flatten(renderer.root.findByType(Text).props.style).flexShrink).toBe(1);
  });

  it('headerTitleWithIcon gives a stack screen [icon] Title as its header title', () => {
    const options = headerTitleWithIcon(screenIcons.contact, 'Contact us');
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(options.headerTitle());
    });

    expect(renderer.root.findByType(screenIcons.contact)).toBeDefined();
    expect(renderer.root.findByType(Text).props.children).toBe('Contact us');
  });
});

import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Platform, StyleSheet, Text } from 'react-native';
import { ScreenTitle, SCREEN_TITLE_ICON_SIZE } from '../../components/ScreenTitle';
import { ArchiveIcon } from '../../icons/ArchiveIcon';
import { ClockIcon } from '../../icons/ClockIcon';
import { CreditCardIcon } from '../../icons/CreditCardIcon';
import { HelpIcon } from '../../icons/HelpIcon';
import { InfoIcon } from '../../icons/InfoIcon';
import { headerTitleWithIcon, screenIcons } from '../screenIcons';

const goBack = jest.fn();

describe('navigation identity: one icon per navigation item', () => {
  it('내 페이지: 도움말 is a question mark, 고객센터 stays info, 구독 is a payment card - three distinct glyphs', () => {
    expect(screenIcons.help).toBe(HelpIcon);
    expect(screenIcons.customerCenter).toBe(InfoIcon);
    expect(screenIcons.subscription).toBe(CreditCardIcon);
    expect(new Set([screenIcons.help, screenIcons.customerCenter, screenIcons.subscription]).size).toBe(3);
  });

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
    for (const key of ['friends', 'language', 'collectionLock', 'trash', 'customerCenter', 'account', 'collectionShare', 'link', 'help', 'deleteAccount']) {
      expect(stack).toMatch(new RegExp(`screenIcons\\.${key}`));
    }
    // Every titled stack screen shows [icon] Title - the ones that used to be plain text included.
    for (const name of ['CollectionShare', 'MyCollectionSubmissions', 'NewLinkReview', 'HelpGuideSection', 'DeleteAccount']) {
      const declaration = stack.slice(stack.indexOf(`name="${name}"`), stack.indexOf('/>', stack.indexOf(`name="${name}"`)));
      expect(declaration).toMatch(/headerTitleWithIcon\(screenIcons\.\w+/);
    }
  });

  it('the Subscription route exists only while the server says the paid program is live (no purchase can be reached before)', () => {
    const stack: string = require('fs').readFileSync(require('path').resolve(__dirname, '../RootStack.tsx'), 'utf8');
    expect(stack).toMatch(/const isSubscriptionProgramLive = entitlement\?\.programEnabled === true;/);
    expect(stack).toMatch(/\{isSubscriptionProgramLive \? \(\s*<Stack\.Screen component=\{themedScreen\(SubscriptionScreen\)\} name="Subscription"/);
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

  it('headerTitleWithIcon on iOS: [arrow] [icon] Title as the screen\'s own header, not in the system bar', () => {
    const options = headerTitleWithIcon(screenIcons.customerCenter, 'Customer Center');
    expect(options).not.toHaveProperty('unstable_headerLeftItems');
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } }}>
          <NavigationContainer>
            {options.header!({ back: { title: 'x', href: undefined }, navigation: { goBack }, options: {}, route: { key: 'r', name: 'R' } } as never)}
          </NavigationContainer>
        </SafeAreaProvider>,
      );
    });

    expect(renderer.root.findByType(screenIcons.customerCenter)).toBeDefined();
    expect(renderer.root.findByType(Text).props.children).toBe('Customer Center');
    act(() => renderer.root.findByProps({ testID: 'header-back' }).props.onPress());
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('headerTitleWithIcon on Android keeps the native toolbar title', () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const options = headerTitleWithIcon(screenIcons.customerCenter, 'Customer Center');
    platform.restore();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create((options.headerTitle as () => React.ReactElement)());
    });
    expect(renderer.root.findByType(Text).props.children).toBe('Customer Center');
  });
});

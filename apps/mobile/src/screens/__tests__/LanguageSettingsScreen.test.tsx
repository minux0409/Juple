import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { LanguageSettingsScreen } from '../LanguageSettingsScreen';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

it('reserves the system bar outside the scroll viewport and still saves the last language', async () => {
  const originalLanguage = i18n.language;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<LanguageSettingsScreen />); });
  try {
    const safeArea = renderer.root.findByType(SafeAreaView);
    expect(safeArea.props.edges).toEqual(['bottom']);
    expect(StyleSheet.flatten(safeArea.props.style).flex).toBe(1);
    const scroll = safeArea.findByType(ScrollView);
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBeUndefined();
    const last = scroll.props.children.at(-1);
    await act(async () => { await last.props.onPress(); });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(expect.any(String), 'hi');
    expect(scroll.props.children.at(-1).props.accessibilityState.selected).toBe(true);
  } finally {
    await act(async () => { renderer.unmount(); await i18n.changeLanguage(originalLanguage); });
  }
});

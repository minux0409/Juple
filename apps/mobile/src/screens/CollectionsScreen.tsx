import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/RootStack';

/**
 * First-pass shell for the 보관함 tab. There is no Collection backend/model yet, so this does not
 * show a "새 보관함" button (it would be a dead end) and does not repurpose the existing
 * Wishlist/Archive data as if it were already a Collection - it only offers plain, clearly-labeled
 * links to the existing screens while they remain reachable outside the Bottom Tabs.
 */
export function CollectionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>보관함</Text>
        <Text style={styles.empty}>보관함이 아직 없습니다.</Text>

        <Text style={styles.sectionTitle}>기존 화면</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Wishlist')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>위시리스트 보기</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Archive')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>보관 보기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  empty: {
    color: '#666666',
    fontSize: 14,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 32,
    marginBottom: 12,
  },
  linkButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    paddingVertical: 12,
  },
  linkButtonLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});

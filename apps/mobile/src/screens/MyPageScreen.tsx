import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootStack';

/**
 * First-pass shell for the 내 페이지 tab. There is no per-user profile endpoint yet (no
 * email/name is exposed to the client anywhere in this app), so the account section only shows
 * the one thing already safely known here - that the session is authenticated - rather than
 * inventing or decoding token claims for display. 설정 is a bare entry point (no fake destination)
 * for the same "no dead-end button" reason Collections keeps 새 보관함 out.
 */
export function MyPageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>내 페이지</Text>

        <Text style={styles.sectionTitle}>계정</Text>
        <Text style={styles.accountStatus}>Juple 계정으로 로그인되어 있습니다.</Text>

        <Text style={styles.sectionTitle}>설정</Text>

        <Text style={styles.sectionTitle}>기존 기능</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('PurchaseHistory')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>구매내역 보기</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            signOut();
          }}
          style={styles.signOutButton}
        >
          <Text style={styles.signOutLabel}>로그아웃</Text>
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 32,
    marginBottom: 12,
  },
  accountStatus: {
    color: '#111111',
    fontSize: 15,
  },
  linkButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 12,
  },
  linkButtonLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  signOutButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 'auto',
    paddingVertical: 12,
  },
  signOutLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});

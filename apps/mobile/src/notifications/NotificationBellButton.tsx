import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/RootStack';
import { useNotificationBadge } from './NotificationBadgeContext';

const MAX_DISPLAYED_COUNT = 99;

/** Placed in each main tab screen's own title row (see MainTabs - there is no shared header to hang this on instead). */
export function NotificationBellButton() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { unreadCount } = useNotificationBadge();

  return (
    <Pressable
      accessibilityLabel="Notifications"
      accessibilityRole="button"
      onPress={() => navigation.navigate('Notifications')}
      style={styles.button}
    >
      <Text style={styles.bell}>🔔</Text>
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text numberOfLines={1} style={styles.badgeLabel}>
            {unreadCount > MAX_DISPLAYED_COUNT ? `${MAX_DISPLAYED_COUNT}+` : unreadCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
  bell: {
    fontSize: 22,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    borderRadius: 9,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -2,
    top: -2,
  },
  badgeLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});

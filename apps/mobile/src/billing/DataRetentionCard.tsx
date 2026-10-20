import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useOptionalAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootStack';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { describeDataRetention, formatRetentionDate } from './dataRetentionView';

/**
 * 구독 > the data retention notice: read-only since when, kept until when, the next notice - only the dates the server sent, and only
 * while the server reports a retention state (never while billing is off or access is live). Offers the data export when the server
 * enables it. Subscribing again is the screen's own Subscribe button right below. Presentation only: the server refuses the writes.
 */
export function DataRetentionCard() {
  const { t, i18n } = useTranslation();
  const auth = useOptionalAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const view = describeDataRetention(auth?.dataRetention);
  if (!view) {
    return null;
  }

  return (
    <View style={styles.card} testID="data-retention-card">
      <Text accessibilityRole="header" style={styles.title}>{t(view.titleKey)}</Text>
      <Text style={styles.body} testID="data-retention-body">
        {t(view.bodyKey, view.bodyDateUtc ? { date: formatRetentionDate(view.bodyDateUtc, i18n.language) } : undefined)}
      </Text>
      {view.rows.map(row => (
        <View key={row.id} style={styles.row} testID={`data-retention-row-${row.id}`}>
          <Text style={styles.rowLabel}>{t(row.labelKey)}</Text>
          <Text style={styles.rowValue}>{formatRetentionDate(row.valueUtc, i18n.language)}</Text>
        </View>
      ))}
      {auth?.dataExportEnabled ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('DataExport')}
          style={styles.button}
          testID="data-retention-export"
        >
          <Text numberOfLines={2} style={styles.buttonLabel}>{t('retention.exportAction')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginTop: spacing.lg, padding: spacing.lg, rowGap: spacing.xs, ...cardShadow },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', marginTop: spacing.xs },
  rowLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, lineHeight: 20 },
  rowValue: { color: colors.textPrimary, flexShrink: 1, fontSize: 14, fontWeight: '600', lineHeight: 20, textAlign: 'right' },
  button: { alignItems: 'center', alignSelf: 'flex-start', borderColor: colors.brand, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', marginTop: spacing.sm, maxWidth: '100%', minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  buttonLabel: { color: colors.brand, fontSize: 15, fontWeight: '600', textAlign: 'center' },
}));

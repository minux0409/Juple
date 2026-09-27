import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DISPLAY_NAME_MAX_STORAGE_LENGTH } from '../api/profileApi';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

interface DisplayNameDialogProps {
  readonly visible: boolean;
  readonly initialValue: string;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  /** Receives the raw text; the server trims it and an empty value clears the name. */
  readonly onSave: (value: string) => void;
}

/**
 * Edits the optional name collaborators see. Single line only (no line breaks can be typed), any
 * script or emoji; the server is the authority on validation and reports anything it rejects.
 */
export function DisplayNameDialog({ visible, initialValue, isSaving, error, onCancel, onSave }: DisplayNameDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [initialValue, visible]);

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>{t('myPage.nickname')}</Text>
          <TextInput
            accessibilityLabel={t('myPage.nickname')}
            autoFocus
            editable={!isSaving}
            maxLength={DISPLAY_NAME_MAX_STORAGE_LENGTH}
            multiline={false}
            onChangeText={setValue}
            onSubmitEditing={() => onSave(value)}
            placeholder={t('myPage.displayNamePlaceholder')}
            returnKeyType="done"
            style={styles.input}
            testID="display-name-input"
            value={value}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={isSaving} onPress={onCancel} style={styles.secondary}>
              <Text style={styles.secondaryLabel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: isSaving }}
              disabled={isSaving}
              onPress={() => onSave(value)}
              style={styles.primary}
              testID="display-name-save"
            >
              {isSaving ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.primaryLabel}>{t('common.save')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, maxWidth: 420, padding: spacing.lg, width: '100%' },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', marginTop: spacing.lg },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  primary: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, minWidth: 88, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700' },
});

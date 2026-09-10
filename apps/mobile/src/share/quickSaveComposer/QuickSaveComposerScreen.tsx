import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';
import { useQuickSaveComposer, type ComposerPhase } from './useQuickSaveComposer';

interface QuickSaveComposerScreenProps {
  readonly pendingShareId: string | null;
}

const ERROR_MESSAGE_KEYS: Partial<Record<ComposerPhase, string>> = {
  reviewRequired: 'quickSaveComposer.reviewRequiredMessage',
  authenticationRequired: 'quickSaveComposer.authenticationRequiredMessage',
  retryableFailure: 'quickSaveComposer.retryableFailureMessage',
  permanentFailure: 'quickSaveComposer.permanentFailureMessage',
};

/**
 * Small bottom-sheet-styled composer hosted by QuickSaveComposerActivity (a translucent, dedicated
 * Activity - see styles.xml) rather than the full app: tapping outside or Cancel discards the
 * share with no Item ever created; Save hands a confirmed title/category off to the existing
 * durable headless save pipeline and waits for its outcome without booting any navigation stack.
 */
export function QuickSaveComposerScreen({ pendingShareId }: QuickSaveComposerScreenProps) {
  const { t } = useTranslation();
  const {
    phase,
    displayText,
    title,
    setTitle,
    categories,
    selectedCollectionId,
    setSelectedCollectionId,
    save,
    cancel,
    close,
  } = useQuickSaveComposer(pendingShareId);

  const isBusy = phase === 'saving';
  const isReady = phase === 'ready';
  const errorMessageKey = ERROR_MESSAGE_KEYS[phase];

  return (
    <View style={styles.backdrop}>
      <Pressable
        accessibilityRole="button"
        disabled={!isReady}
        onPress={cancel}
        style={StyleSheet.absoluteFill}
      />
      {/*
        QuickSaveComposerActivity's translucent theme (see styles.xml) makes
        windowSoftInputMode="adjustResize" unreliable - confirmed on-device: the composer's own
        card render was fully behind/covered by the keyboard instead of the window shrinking above
        it. "height" (rather than "padding", which is the iOS-appropriate one) tracks the actual
        Keyboard show/hide events directly instead of depending on that native window resize.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoider}
      >
        <View style={styles.card}>
          {phase === 'loading' ? (
            <ActivityIndicator style={styles.loading} />
          ) : phase === 'success' ? (
            <Text style={styles.statusMessage}>{t('quickSaveComposer.savedMessage')}</Text>
          ) : phase === 'queued' ? (
            <Text style={styles.statusMessage}>{t('quickSaveComposer.queuedMessage')}</Text>
          ) : errorMessageKey ? (
            <View>
              <Text style={styles.errorMessage}>{t(errorMessageKey)}</Text>
              <View style={styles.buttonRow}>
                {phase === 'retryableFailure' ? (
                  <Pressable accessibilityRole="button" onPress={save} style={styles.saveButton}>
                    <Text style={styles.saveButtonLabel}>{t('quickSaveComposer.retry')}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" onPress={close} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonLabel}>{t('quickSaveComposer.close')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.brand}>Juple</Text>
              <Text numberOfLines={1} style={styles.domain}>
                {displayText}
              </Text>

              <Text style={styles.fieldLabel}>{t('quickSaveComposer.titleLabel')}</Text>
              <TextInput
                autoFocus
                editable={!isBusy}
                onChangeText={setTitle}
                placeholder={t('quickSaveComposer.titlePlaceholder')}
                style={styles.titleInput}
                value={title}
              />

              {categories.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>{t('quickSaveComposer.categoryLabel')}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.categoryRow}
                  >
                    <CategoryChip
                      isSelected={selectedCollectionId === null}
                      label={t('quickSaveComposer.categoryNone')}
                      onPress={() => setSelectedCollectionId(null)}
                    />
                    {categories.map(category => (
                      <CategoryChip
                        key={category.id}
                        isSelected={selectedCollectionId === category.id}
                        label={category.name}
                        onPress={() => setSelectedCollectionId(category.id)}
                      />
                    ))}
                  </ScrollView>
                </>
              ) : null}

              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityLabel={t('quickSaveComposer.cancel')}
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={cancel}
                  style={[styles.cancelButton, isBusy && styles.disabledButton]}
                >
                  <Text style={styles.cancelButtonLabel}>{t('quickSaveComposer.cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={t('quickSaveComposer.save')}
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={save}
                  style={[styles.saveButton, isBusy && styles.disabledButton]}
                >
                  {isBusy ? (
                    <ActivityIndicator color={colors.surface} size="small" />
                  ) : (
                    <Text style={styles.saveButtonLabel}>{t('quickSaveComposer.save')}</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

interface CategoryChipProps {
  readonly label: string;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}

function CategoryChip({ label, isSelected, onPress }: CategoryChipProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[styles.chip, isSelected && styles.chipSelected]}
    >
      <Text numberOfLines={1} style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  keyboardAvoider: {
    width: '100%',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xl + spacing.md,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  statusMessage: {
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  errorMessage: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  brand: {
    fontSize: 16,
    fontWeight: '700',
  },
  domain: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  titleInput: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  categoryRow: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    marginEnd: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSelected: {
    backgroundColor: colors.textPrimary,
  },
  chipLabel: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  chipLabelSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  cancelButtonLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  saveButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});

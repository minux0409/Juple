import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppModal } from '../components/AppModal';
import { CheckIcon } from '../icons/CheckIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { SUPPORT_INQUIRY_TYPES, type SupportInquiryType } from './api/supportInquiryApi';
import { inquiryTypeLabel } from './inquiryFormat';

interface InquiryTypePickerDialogProps {
  readonly visible: boolean;
  readonly selected: SupportInquiryType | null;
  readonly onSelect: (type: SupportInquiryType) => void;
  readonly onClose: () => void;
}

/** 문의 유형: seven values in Juple's compact centered dialog (never a bottom sheet) - one tap picks and closes. */
export function InquiryTypePickerDialog({ visible, selected, onSelect, onClose }: InquiryTypePickerDialogProps) {
  const { t } = useTranslation();
  return (
    <AppModal onClose={onClose} testID="inquiry-type-picker" title={t('inquiry.typePickerTitle')} visible={visible}>
      <View accessibilityRole="radiogroup">
        {SUPPORT_INQUIRY_TYPES.map(type => {
          const isSelected = selected === type;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              key={type}
              onPress={() => onSelect(type)}
              style={styles.option}
              testID={`inquiry-type-${type}`}
            >
              <Text style={[styles.label, isSelected && styles.labelSelected]}>{inquiryTypeLabel(t, type)}</Text>
              {isSelected ? <CheckIcon color={colors.brand} size={18} /> : null}
            </Pressable>
          );
        })}
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  option: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', minHeight: minTouchTarget, paddingVertical: spacing.sm },
  label: { color: colors.textPrimary, flex: 1, fontSize: 16 },
  labelSelected: { color: colors.brand, fontWeight: '700' },
});

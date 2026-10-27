import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type TextInputProps } from 'react-native';
import { Pressable } from './Pressable';
import { ThemedTextInput } from './ThemedTextInput';
import { EyeIcon } from '../icons/EyeIcon';
import { EyeOffIcon } from '../icons/EyeOffIcon';
import { colors, minTouchTarget, themedStyles } from '../theme/tokens';

export function PasswordInput(props: TextInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeIcon : EyeOffIcon;
  return <View style={styles.row}>
    <ThemedTextInput {...props} secureTextEntry={!visible} style={[props.style, styles.input]} />
    <Pressable accessibilityLabel={t(visible ? 'collections.sharePasswordHide' : 'collections.sharePasswordShow')}
      accessibilityRole="button" accessibilityState={{ selected: visible }} disabled={props.editable === false}
      onPress={() => setVisible(value => !value)} style={styles.toggle} testID={`${props.testID}-visibility`}>
      <Icon color={colors.textSecondary} size={20} />
    </Pressable>
  </View>;
}
const styles = themedStyles(() => ({
  row: { position: 'relative', width: '100%' },
  input: { paddingRight: minTouchTarget + 4 },
  toggle: { position: 'absolute', right: 0, top: 0, bottom: 0, width: minTouchTarget, alignItems: 'center', justifyContent: 'center' },
}));

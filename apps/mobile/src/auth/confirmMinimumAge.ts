import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

/** Self-declaration before the identity provider collects sign-in/sign-up data; no date of birth is collected. */
export function confirmMinimumAge(t: TFunction): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(t('agreement.ageConfirmation'), t('agreement.ageNotice'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('common.confirm'), onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

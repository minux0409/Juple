import { Alert } from 'react-native';
import i18n from '../../i18n';
import { confirmMinimumAge } from '../confirmMinimumAge';

it('continues only after explicit confirmation; cancel and dismiss refuse sign-in', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const confirmed = confirmMinimumAge(i18n.t);
  alert.mock.calls[0][2]![1].onPress!();
  await expect(confirmed).resolves.toBe(true);
  const cancelled = confirmMinimumAge(i18n.t);
  alert.mock.calls[1][2]![0].onPress!();
  await expect(cancelled).resolves.toBe(false);
  const dismissed = confirmMinimumAge(i18n.t);
  alert.mock.calls[2][3]!.onDismiss!();
  await expect(dismissed).resolves.toBe(false);
  alert.mockRestore();
});

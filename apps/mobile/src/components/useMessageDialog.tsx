import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';

interface MessageOptions {
  /** Defaults to the generic 알림 title. */
  readonly title?: string;
  /** Runs once the person closes the message (e.g. leaving the screen after a finished save). */
  readonly onDone?: () => void;
}

interface ShownMessage {
  readonly title: string;
  readonly text: string;
  readonly onDone?: () => void;
}

/**
 * The result of something the person just did (a save, an upload, a delete) - said in the shared
 * single-button ConfirmDialog, centered and never a red line that scrolls out of sight or hides under
 * the keyboard. The keyboard is closed first so it can never cover the dialog. Nothing on the screen
 * is reset by it: drafts stay as typed. Field validation that belongs next to its field stays inline.
 */
export function useMessageDialog() {
  const { t } = useTranslation();
  const [shown, setShown] = useState<ShownMessage | null>(null);

  const showMessage = useCallback(
    (text: string, options: MessageOptions = {}) => {
      Keyboard.dismiss();
      setShown({ title: options.title ?? t('common.notice'), text, onDone: options.onDone });
    },
    [t],
  );

  const messageDialog = (
    <ConfirmDialog
      confirmLabel={t('common.confirm')}
      destructive={false}
      message={shown?.text ?? ''}
      onConfirm={() => {
        const done = shown?.onDone;
        setShown(null);
        done?.();
      }}
      title={shown?.title ?? ''}
      visible={shown !== null}
    />
  );

  return { showMessage, messageDialog };
}

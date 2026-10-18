import { Glyph } from './Glyph';
import styles from './app.module.css';

/**
 * The one "just close this window" control of every dialog / sheet: an X at the top right with a 44px touch / click area, a visible
 * hover and keyboard focus state, and the dialog's own localized "닫기" as its accessible name. Choosing it changes nothing; a
 * decision to abandon an action (취소) stays a text button next to the action.
 */
export function ModalCloseButton({ label, onClick, disabled }: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }) {
  return (
    <button aria-label={label} className={styles.modalCloseButton} disabled={disabled} onClick={onClick} title={label} type="button">
      <Glyph name="Close" size={22} />
    </button>
  );
}

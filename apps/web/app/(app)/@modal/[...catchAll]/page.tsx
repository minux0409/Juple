/**
 * Any other address closes the Quick Detail sheet: a parallel slot keeps its last state across soft navigations, so without this the
 * sheet would stay open over (for example) the editor that 수정 opens.
 */
export default function CloseQuickDetail() {
  return null;
}

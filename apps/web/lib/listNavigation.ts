/**
 * Keyboard movement in the pill listbox and the ⋯ menus (app/(app)/Popover.tsx) - pure, so it is unit-tested without a browser.
 */

/** Moves the active row with the arrows / Home / End, skipping disabled rows; returns the next index (or the same). */
export function nextActiveIndex(current: number, key: string, disabled: readonly boolean[]): number {
  const count = disabled.length;
  if (count === 0) {
    return -1;
  }
  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (key === 'Home' || key === 'End') {
    const order = key === 'Home' ? [...Array(count).keys()] : [...Array(count).keys()].reverse();
    return order.find(index => !disabled[index]) ?? current;
  }
  if (step === 0) {
    return current;
  }
  for (let offset = 1; offset <= count; offset += 1) {
    const candidate = (((current + step * offset) % count) + count) % count;
    if (!disabled[candidate]) {
      return candidate;
    }
  }
  return current;
}

'use client';

import { useRef, type MouseEvent, type PointerEvent } from 'react';

function isOutside(dialog: HTMLDialogElement, x: number, y: number): boolean {
  const rect = dialog.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/**
 * A click on a modal <dialog>'s backdrop (outside its panel) dismisses it - the same as Escape or the close button: it only CLOSES,
 * never confirms, deletes or cancels anything. A press that started inside the panel (selecting text, dragging) and ended outside
 * does not count, and nothing happens while `enabled` is false (a request in flight).
 */
export function useBackdropDismiss(onDismiss: () => void, enabled = true) {
  const startedOutside = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      startedOutside.current = event.target === event.currentTarget && isOutside(event.currentTarget, event.clientX, event.clientY);
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const outside = startedOutside.current && event.target === event.currentTarget && isOutside(event.currentTarget, event.clientX, event.clientY);
      startedOutside.current = false;
      if (outside && enabled) {
        onDismiss();
      }
    },
  };
}

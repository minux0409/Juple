export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SuggestionOverlayFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** Room left under the field before the screen's (or the keyboard's) bottom edge; the panel scrolls inside it. */
  readonly maxHeight: number;
  /** The field itself is out of the visible area (scrolled away): the panel has nothing to hang from and closes. */
  readonly anchorHidden: boolean;
}

/** The panel never gets smaller than this (a couple of rows): below it there is no useful room and it simply stays at this size. */
export const MIN_PANEL_HEIGHT = 120;

/**
 * Where the suggestion panel goes, in the coordinates of the container it is drawn in. Both rectangles are WINDOW coordinates
 * (measureInWindow), so the field's real border box is the single source of truth: scroll offset, status bar, safe area and the
 * list header above the field are all already inside it - none is added or subtracted again.
 *  left / width = the field's own edges; top = the field's bottom + gap.
 * `bottomLimit` is the lowest window y the panel may reach (the keyboard's top, or the window's bottom); the container's own bottom
 * is the other limit.
 */
export function getSuggestionOverlayFrame({
  root,
  search,
  gap,
  bottomLimit,
}: {
  readonly root: WindowRect;
  readonly search: WindowRect;
  readonly gap: number;
  readonly bottomLimit: number;
}): SuggestionOverlayFrame {
  const top = search.y - root.y + search.height + gap;
  const lowest = Math.min(root.y + root.height, bottomLimit);
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, lowest - (root.y + top));
  return {
    left: search.x - root.x,
    top,
    width: search.width,
    maxHeight,
    anchorHidden: search.y + search.height <= root.y || search.y >= root.y + root.height,
  };
}

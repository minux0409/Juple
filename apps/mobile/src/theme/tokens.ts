/**
 * Shared spacing/color/radius values used by screens touched by the UI density refactor.
 * Plain constants only - no theming context/provider, not applied retroactively to
 * screens this refactor doesn't otherwise touch.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radii = {
  sm: 6,
  md: 8,
  /** Card-level radius (saved-link rows, grouped History sections, category cards) - this round's visual redesign bumped this from 16 to a softer, more modern 20. */
  lg: 20,
  /** Prominent elements - primary buttons. */
  xl: 24,
} as const;

export const colors = {
  textPrimary: '#111111',
  textSecondary: '#666666',
  /** Icon-stroke color (e.g. an unfilled star) - deliberately NOT used for input/card borders, which use the much lighter `inputBorder` instead. */
  border: '#9A9A9A',
  /** Soft input/card border for the redesigned form fields - barely visible against `surface`, unlike the older, darker `border`. */
  inputBorder: '#DDE4EF',
  divider: '#EDF1F7',
  danger: '#B42318',
  warning: '#F5A623',
  success: '#0F7A3D',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F4F9',
  /** Screen-level background - cool, light blue-gray so a white `surface` card reads as clearly lifted off it (this round's full visual redesign, mockup-matched). */
  background: '#F7F9FC',
  /** "Juple blue" - the app's primary/CTA color (buttons, selected tab, selected pill). */
  brand: '#3366CC',
  /** Pale brand tint - selected-chip backgrounds. */
  brandSoft: '#E9F0FE',
} as const;

/**
 * Small fixed palette for category tiles (see CollectionsScreen) - deterministically picked from a
 * Collection's id (`id % categoryTilePalette.length`), never stored/user-chosen, so this stays
 * purely presentational (no new "category icon" domain feature). `icon` tints the folder glyph to
 * match its own `background`.
 */
export const categoryTilePalette = [
  { background: '#EAF1FE', icon: '#5478B0' }, // blue
  { background: '#FBEDEE', icon: '#B97278' }, // red
  { background: '#FBF3DE', icon: '#B0924E' }, // yellow
  { background: '#EAF5EE', icon: '#5C9878' }, // green
  { background: '#F1EBF7', icon: '#8A72A8' }, // purple
  { background: '#FBEEE6', icon: '#BD8863' }, // orange
] as const;

/**
 * The Collections screen's 2x2 filter (즐겨찾기 | 전체 / 내 컬렉션 | 공유 컬렉션): colors for the
 * selected / unselected STATE of a filter cell. The selected cell reuses the existing blue
 * Collection tile pair (categoryTilePalette[0], identical to the 'Blue' preset in
 * collectionColors.ts - the sky-blue card background) with its own darker icon tone as the label
 * color, so it reads as part of the same visual family; it never colors a Collection itself. The
 * unselected cell keeps a visible border and a dark-enough label so it reads as tappable, never as
 * disabled.
 */
export const collectionFilterColors = {
  selectedBackground: categoryTilePalette[0].background,
  /** The default blue folder glyph's stroke color - a crisp outline that keeps the soft fill. */
  selectedBorder: categoryTilePalette[0].icon,
  selectedText: categoryTilePalette[0].icon,
  unselectedBackground: '#F1F2F4',
  unselectedText: '#5F6368',
  unselectedBorder: '#D9DCE1',
} as const;

/**
 * Very soft card elevation (barely-there shadow, matching this round's "그림자는 약하게" - never a
 * heavy drop shadow) - spread as `...cardShadow` into a card container's style alongside its own
 * border/radius. `elevation` is Android's own shadow property; iOS uses the shadow* fields.
 */
export const cardShadow = {
  elevation: 1,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
} as const;

export const minTouchTarget = 44;

/**
 * Forces LTR bidi isolation for technical/identifier text (URLs, email addresses, the Juple brand
 * name) that must never visually reorder inside an RTL (e.g. Arabic) layout - general user-facing
 * text/titles must NOT use this, since those should keep following the active locale's natural
 * reading direction. A plain object (not StyleSheet.create) so it composes into a style array
 * alongside a screen's own StyleSheet-created styles.
 */
export const ltrTextStyle = { writingDirection: 'ltr' } as const;

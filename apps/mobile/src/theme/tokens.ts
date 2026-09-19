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
  /** Card-level radius (saved-link rows, grouped History sections). */
  lg: 16,
} as const;

export const colors = {
  textPrimary: '#111111',
  textSecondary: '#666666',
  border: '#9A9A9A',
  divider: '#E0E0E0',
  danger: '#B42318',
  warning: '#F5A623',
  success: '#0F7A3D',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F5F5',
  /** Screen-level background (lighter than surfaceMuted) so a white `surface` card reads as lifted off it - see this round's density/brightness pass on Home/History/Category/Item Details/New Link Review. */
  background: '#FAFAFA',
  /** "Juple blue" - formalizes the one-off link color already used in ItemDetailsScreen. */
  brand: '#3366CC',
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

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
  /** "Juple blue" - formalizes the one-off link color already used in ItemDetailsScreen. */
  brand: '#3366CC',
} as const;

export const minTouchTarget = 44;
